<script lang="ts">
  /**
   * Workspace
   *
   * Post-login shell that composes the workspace surface: animated background,
   * compact header, optional credentials banner, calendar grid, weekly
   * summary, and the settings drawer overlay. The Activity heatmap panel
   * was removed; CalendarGrid now owns date selection.
   *
   * State ownership lives here for values that cross sibling boundaries:
   *   - `selectedDate` shared between CalendarGrid and QuickLogCard
   *   - `recentIssues` shared between QuickLogCard (display) and the upsert
   *     path on submission/queue
   *   - `worklogsByDate` shared between CalendarGrid and WeeklySummary
   *   - `workspaceSettings` (targetHours feeds WeeklySummary)
   *
   * Worklog refreshes go through `fetchWorklogs(force)` directly: cache-
   * friendly navigations leave `force=false`, while user-driven refreshes
   * (submit/sync/credential change) use `force=true` to bypass the
   * freshness window.
   */

  import { invoke } from "@tauri-apps/api/core";

  import AnimatedBackground from "../components/AnimatedBackground.svelte";
  import WorkspaceHeader from "../components/WorkspaceHeader.svelte";
  import CredentialsBanner from "../components/CredentialsBanner.svelte";
  import CalendarGrid from "../components/CalendarGrid.svelte";
  import QuickLogCard from "../components/QuickLogCard.svelte";
  import WeeklySummary from "../components/WeeklySummary.svelte";
  import SettingsDrawer from "../components/SettingsDrawer.svelte";
  import AuditLogPanel from "../components/AuditLogPanel.svelte";

  import {
    loadRecentIssues,
    saveRecentIssues,
    upsertRecentIssue,
    type RecentIssue,
  } from "../stores/recentIssuesStore";
  import type { WorklogDay } from "../stores/heatmapStore";
  import type { WorklogEntry } from "../stores/worklogStore";
  import {
    loadWorkspaceSettings,
    DEFAULT_WORKSPACE_SETTINGS,
    jiraStarted,
    type WorkspaceSettings,
  } from "../stores/settingsStore";
  import {
    loadCredentials,
    isCredentialComplete,
    type Credentials,
  } from "../stores/authStore";
  import { syncPendingWorklogs } from "../stores/offlineStore";
  import {
    readCache,
    writeCache,
  } from "../stores/worklogCacheStore";
  import {
    loadAutoScheduleConfig,
    loadProcessedSlots,
    saveProcessedSlots,
    computeEligibleSlots,
    slotKey,
    DEFAULT_AUTO_SCHEDULE_CONFIG,
    type AutoScheduleConfig,
  } from "../stores/autoScheduleStore";
  import { isHoliday } from "../stores/indonesianHolidaysStore";
  import {
    loadAuditLog,
    saveAuditLog,
    clearAuditLog,
    makeAuditEntry,
    prependCapped,
    type AuditEntry,
  } from "../stores/auditLogStore";

  interface Props {
    displayName: string;
    email: string;
    onLogout: () => void;
  }

  let { displayName, email, onLogout }: Props = $props();

  // ---------------------------------------------------------------------
  // Today (frozen for the session). Re-acquired implicitly on remount.
  // ---------------------------------------------------------------------
  const today = new Date();

  function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const todayStr = toYMD(today);

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let selectedDate = $state<string>(todayStr);

  // ---------------------------------------------------------------------
  // Worklog fetch range
  //
  // Dibatasi maksimal ±2 bulan agar loading ringan: setiap fetch mencakup
  // tanggal 1 bulan sebelumnya s/d Sabtu di minggu `today`. Artinya
  //   - bulan berjalan + satu bulan penuh ke belakang selalu tersedia,
  //     jadi CalendarGrid bisa mundur satu bulan tanpa re-fetch;
  //   - navigasi lebih jauh ke belakang menampilkan hari kosong (datanya
  //     memang tidak di-fetch — trade-off untuk performa);
  //   - the end-date snaps to a Saturday so it matches how WeeklySummary
  //     thinks about ISO weeks.
  //
  // Computed once from `today` (which is itself frozen for the session),
  // so the cache key stays stable across renders.
  // ---------------------------------------------------------------------

  function startOfPrevMonthYMD(d: Date): string {
    return toYMD(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  function endOfWeekSaturdayYMD(d: Date): string {
    const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - d.getDay()));
    return toYMD(sat);
  }

  const fetchStartDate = startOfPrevMonthYMD(today);
  const fetchEndDate = endOfWeekSaturdayYMD(today);

  let recentIssues = $state<RecentIssue[]>([]);
  let recentIssuesReady = $state<boolean>(false);
  let recentIssuesError = $state<string | null>(null);

  // CalendarGrid mode + cursor — diangkat ke Workspace agar WeeklySummary
  // bisa men-track periode aktif (Day/Week/Month) yang sama dengan
  // CalendarGrid. CalendarGrid memiliki UI untuk mengganti keduanya;
  // Workspace cuma menyimpan state-nya.
  type CalendarMode = "day" | "week" | "month" | "list";
  let calMode = $state<CalendarMode>("month");
  let calCursorDate = $state<Date>(new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  // WeeklySummary tidak punya mode "list", jadi kita fall back ke "month"
  // (paling masuk akal: list view menampilkan semua entri di seluruh
  // periode, sehingga summary bulanan paling sejajar konteksnya).
  let summaryMode = $derived<"day" | "week" | "month">(
    calMode === "list" ? "month" : calMode,
  );

  function handleCalendarModeChange(next: CalendarMode): void {
    calMode = next;
  }

  function handleCalendarCursorChange(ymd: string): void {
    const [y, m, d] = ymd.split("-").map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      calCursorDate = new Date(y, (m as number) - 1, d as number);
    }
  }

  /**
   * Pure: derive a new `started` ISO 8601 string by replacing the date
   * portion while preserving the original time-of-day + timezone offset.
   * Falls back to `{targetDate}T09:00:00.000+0000` when no source value is
   * available — 09:00 is a reasonable default for a workday log.
   */
  function rewriteStartedDate(
    sourceStarted: string | undefined,
    targetDate: string,
  ): string {
    if (!sourceStarted || sourceStarted.length < 10) {
      return `${targetDate}T09:00:00.000+0000`;
    }
    return `${targetDate}${sourceStarted.slice(10)}`;
  }

  /**
   * Stage a cross-day drag as a pending edit instead of writing to Jira
   * immediately. The move shows in the UI right away (via the
   * `worklogsByDate` derived) and is committed only when the user clicks
   * "Submit changes".
   */
  function handleWorklogMoved(move: {
    worklogId: string;
    issueKey: string;
    sourceDate: string;
    targetDate: string;
    timeSpentSeconds: number;
    sourceStarted?: string;
  }): void {
    if (move.sourceDate === move.targetDate) return;
    stageEdit({
      worklogId: move.worklogId,
      issueKey: move.issueKey,
      started: rewriteStartedDate(move.sourceStarted, move.targetDate),
      timeSpentSeconds: move.timeSpentSeconds,
    });
  }

  /**
   * Stage a Day/Week reschedule/resize (new start time, duration, and/or
   * day) as a pending edit. Same staging model as `handleWorklogMoved`.
   */
  function handleWorklogReschedule(change: {
    worklogId: string;
    issueKey: string;
    sourceDate: string;
    date: string;
    started: string;
    timeSpentSeconds: number;
    hours: number;
  }): void {
    stageEdit({
      worklogId: change.worklogId,
      issueKey: change.issueKey,
      started: change.started,
      timeSpentSeconds: change.timeSpentSeconds,
    });
  }

  // ---------------------------------------------------------------------
  // Staged calendar edits
  //
  // Drag/resize/move interactions in CalendarGrid no longer persist to Jira
  // on release. Instead each one is recorded as a `PendingEdit` (keyed by
  // worklogId, so repeated drags on the same entry collapse to one) and shown
  // optimistically via the `worklogsByDate` derived. Nothing reaches Jira
  // until the user clicks "Submit changes"; "Discard" drops the staging and
  // the derived snaps back to server truth.
  // ---------------------------------------------------------------------

  interface PendingEdit {
    worklogId: string;
    issueKey: string;
    /** New Jira `started` ISO string (its date portion is the target day). */
    started: string;
    timeSpentSeconds: number;
  }

  /**
   * Draf worklog hasil generate penjadwalan otomatis. Belum ada di Jira —
   * tampil di kalender (via `worklogsByDate`) agar bisa diperiksa, diedit,
   * digeser, atau dihapus dulu, lalu dikirim sekaligus lewat
   * "Submit changes".
   */
  interface PendingDraft {
    draftId: string;
    /** Activity + tanggal jadwal asal — kunci dedup saat regenerasi. */
    sourceActivityId: string;
    sourceDate: string;
    issueKey: string;
    summary: string;
    hours: number;
    description: string;
    /** Jira `started` ISO; tanggal tampil = `started.slice(0, 10)`. */
    started: string;
  }

  const DRAFT_ID_PREFIX = "draft-";

  function isDraftId(id: string | null | undefined): boolean {
    return !!id && id.startsWith(DRAFT_ID_PREFIX);
  }

  function newDraftId(): string {
    return `${DRAFT_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function stageEdit(edit: PendingEdit): void {
    // Entri draf belum ada di Jira — perbarui draf-nya langsung alih-alih
    // menstaging update_worklog.
    if (isDraftId(edit.worklogId)) {
      const draft = pendingDrafts[edit.worklogId];
      if (draft) {
        pendingDrafts = {
          ...pendingDrafts,
          [edit.worklogId]: {
            ...draft,
            started: edit.started,
            hours: edit.timeSpentSeconds / 3600,
          },
        };
      }
      submitChangesError = null;
      return;
    }
    pendingEdits = { ...pendingEdits, [edit.worklogId]: edit };
    submitChangesError = null;
  }

  /**
   * Return a view of `base` with every staged edit applied: each edited
   * worklog is relocated to the day implied by its new `started`, with its
   * duration/hours updated. Worklogs missing from `base` (e.g. deleted
   * meanwhile) are skipped. Pure — never mutates `base`.
   */
  function applyPendingEdits(
    base: Record<string, WorklogDay>,
    edits: Record<string, PendingEdit>,
  ): Record<string, WorklogDay> {
    const ids = Object.keys(edits);
    if (ids.length === 0) return base;

    let next: Record<string, WorklogDay> = { ...base };
    for (const id of ids) {
      const edit = edits[id];

      // Detach the current entry wherever it currently lives.
      let entry: WorklogEntry | null = null;
      for (const [d, day] of Object.entries(next)) {
        const idx = day.entries.findIndex((e) => e.id === id);
        if (idx < 0) continue;
        entry = day.entries[idx];
        const rest = day.entries.filter((e) => e.id !== id);
        if (rest.length === 0) {
          const without = { ...next };
          delete without[d];
          next = without;
        } else {
          next = {
            ...next,
            [d]: { totalHours: rest.reduce((s, e) => s + e.hours, 0), entries: rest },
          };
        }
        break;
      }
      if (!entry) continue;

      const hours = edit.timeSpentSeconds / 3600;
      const updated: WorklogEntry = {
        ...entry,
        started: edit.started,
        hours,
        timeSpentSeconds: edit.timeSpentSeconds,
      };
      const targetDate = edit.started.slice(0, 10);
      const tgt = next[targetDate] ?? { totalHours: 0, entries: [] };
      const tgtEntries = [...tgt.entries, updated];
      next = {
        ...next,
        [targetDate]: {
          totalHours: tgtEntries.reduce((s, e) => s + e.hours, 0),
          entries: tgtEntries,
        },
      };
    }
    return next;
  }

  /**
   * Layer draft entries (belum ada di Jira) on top of `base` so they render
   * in the calendar. Each carries `pending: true` so CalendarGrid can style
   * them as drafts. Pure — never mutates `base`.
   */
  function applyPendingDrafts(
    base: Record<string, WorklogDay>,
    drafts: Record<string, PendingDraft>,
  ): Record<string, WorklogDay> {
    const list = Object.values(drafts);
    if (list.length === 0) return base;

    let next: Record<string, WorklogDay> = { ...base };
    for (const draft of list) {
      const date = draft.started.slice(0, 10);
      const entry: WorklogEntry = {
        id: draft.draftId,
        issueKey: draft.issueKey,
        summary: draft.summary,
        hours: draft.hours,
        timeSpentSeconds: Math.round(draft.hours * 3600),
        description: draft.description,
        started: draft.started,
        pending: true,
      };
      const day = next[date] ?? { totalHours: 0, entries: [] };
      const entries = [...day.entries, entry];
      next = {
        ...next,
        [date]: {
          totalHours: entries.reduce((s, e) => s + e.hours, 0),
          entries,
        },
      };
    }
    return next;
  }

  /**
   * Commit the whole staging area to Jira: staged calendar edits via
   * `update_worklog`, dan draf jadwal otomatis via `add_worklog`. Setelah
   * itu reconcile dengan server truth so the UI reflects exactly what
   * persisted. Draf yang gagal tetap distaging agar bisa dicoba lagi;
   * tanggal-jadwal sebuah draf ditandai processed hanya bila seluruh draf
   * tanggal itu berhasil terkirim.
   */
  async function submitPendingChanges(): Promise<void> {
    const edits = Object.values(pendingEdits);
    const drafts = Object.values(pendingDrafts);
    if ((edits.length === 0 && drafts.length === 0) || submittingChanges) return;
    if (!isCredentialComplete(credentials)) return;

    submittingChanges = true;
    submitChangesError = null;

    let failed = 0;
    const audits: AuditEntry[] = [];
    for (const edit of edits) {
      const date = edit.started.slice(0, 10);
      const hours = edit.timeSpentSeconds / 3600;
      try {
        await invoke("update_worklog", {
          baseUrl: credentials.baseUrl,
          email: credentials.email,
          apiToken: credentials.apiToken,
          isCloud,
          issueKey: edit.issueKey,
          worklogId: edit.worklogId,
          timeSpentSeconds: edit.timeSpentSeconds,
          started: edit.started,
          comment: null,
        });
        audits.push(
          makeAuditEntry({
            action: "edit",
            source: "manual",
            status: "success",
            issueKey: edit.issueKey,
            date,
            hours,
          }),
        );
      } catch (err) {
        failed += 1;
        audits.push(
          makeAuditEntry({
            action: "edit",
            source: "manual",
            status: "failed",
            issueKey: edit.issueKey,
            date,
            hours,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    // Draf jadwal otomatis → add_worklog.
    const failedDrafts: Record<string, PendingDraft> = {};
    let processedChanged = false;
    for (const draft of drafts) {
      const date = draft.started.slice(0, 10);
      try {
        await invoke("add_worklog", {
          baseUrl: credentials.baseUrl,
          email: credentials.email,
          apiToken: credentials.apiToken,
          isCloud,
          issueKey: draft.issueKey,
          timeSpentSeconds: Math.round(draft.hours * 3600),
          started: draft.started,
          comment: draft.description ?? "",
        });
        autoScheduleProcessed.add(slotKey(draft.sourceActivityId, draft.sourceDate));
        processedChanged = true;
        audits.push(
          makeAuditEntry({
            action: "add",
            source: "auto",
            status: "success",
            issueKey: draft.issueKey,
            date,
            hours: draft.hours,
          }),
        );
      } catch (err) {
        failed += 1;
        failedDrafts[draft.draftId] = draft;
        audits.push(
          makeAuditEntry({
            action: "add",
            source: "auto",
            status: "failed",
            issueKey: draft.issueKey,
            date,
            hours: draft.hours,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // Slot yang gagal sengaja tidak ditandai processed — draf-nya tetap
    // distaging dan bisa dicoba lagi.
    if (processedChanged) {
      try {
        await saveProcessedSlots(autoScheduleProcessed);
      } catch {
        /* best-effort */
      }
    }

    if (audits.length > 0) {
      auditLog = prependCapped(auditLog, audits);
      void saveAuditLog(auditLog);
    }

    pendingEdits = {};
    pendingDrafts = failedDrafts;
    submittingChanges = false;
    if (failed > 0) {
      submitChangesError = `Gagal menyimpan ${failed} perubahan. Silakan coba lagi.`;
    }
    // Reconcile from Jira — `started` may be normalised server-side.
    void fetchWorklogs(true);
  }

  /**
   * Drop all staged edits + draf jadwal; the `worklogsByDate` derived snaps
   * back to server truth automatically. Slot draf yang dibuang ditandai
   * processed — user sudah mereview dan menolaknya, jadi jangan digenerate
   * ulang.
   */
  function discardPendingChanges(): void {
    const drafts = Object.values(pendingDrafts);
    if (drafts.length > 0) {
      for (const draft of drafts) {
        autoScheduleProcessed.add(slotKey(draft.sourceActivityId, draft.sourceDate));
      }
      saveProcessedSlots(autoScheduleProcessed).catch(() => {});
    }
    pendingEdits = {};
    pendingDrafts = {};
    submitChangesError = null;
  }

  // Server truth (from fetch/cache). Immediate ops (add, delete) write here
  // directly; staged drag edits are layered on top via `worklogsByDate`.
  let serverWorklogsByDate = $state<Record<string, WorklogDay>>({});
  // Staged calendar edits, keyed by worklogId. Empty ⇒ nothing pending.
  let pendingEdits = $state<Record<string, PendingEdit>>({});
  // Draf jadwal otomatis, keyed by draftId. Empty ⇒ nothing pending.
  let pendingDrafts = $state<Record<string, PendingDraft>>({});
  let submittingChanges = $state<boolean>(false);
  let submitChangesError = $state<string | null>(null);

  // What CalendarGrid + WeeklySummary render: server truth with any staged
  // edits applied, plus draft entries layered on top. Recomputes when any
  // input changes.
  let worklogsByDate = $derived(
    applyPendingDrafts(applyPendingEdits(serverWorklogsByDate, pendingEdits), pendingDrafts),
  );
  let editCount = $derived(Object.keys(pendingEdits).length);
  let draftCount = $derived(Object.keys(pendingDrafts).length);
  let pendingCount = $derived(editCount + draftCount);
  // Label bar staging — bedakan draf jadwal dari edit kalender biasa.
  let pendingLabel = $derived(
    draftCount > 0 && editCount > 0
      ? `${editCount} perubahan · ${draftCount} draf jadwal otomatis`
      : draftCount > 0
        ? `${draftCount} draf jadwal otomatis — periksa lalu submit`
        : `${editCount} perubahan belum disimpan`,
  );

  let worklogsLoading = $state<boolean>(true);
  let worklogsError = $state<string | null>(null);

  let workspaceSettings = $state<WorkspaceSettings>({
    ...DEFAULT_WORKSPACE_SETTINGS,
  });
  let credentials = $state<Credentials>({
    baseUrl: "",
    email: "",
    apiToken: "",
  });
  let isCloud = $state<boolean>(true);

  // --- Auto-schedule (recurring daily worklogs) ---
  let autoScheduleConfig = $state<AutoScheduleConfig>({
    ...DEFAULT_AUTO_SCHEDULE_CONFIG,
  });
  // Slot (kegiatan × tanggal) yang sudah selesai diproses (persisted):
  // draf-nya sudah disubmit / dibuang user, atau worklog serupa sudah ada di
  // Jira. Per-slot, bukan per-tanggal — menandai seluruh tanggal akan
  // mengunci kegiatan yang ditambahkan belakangan.
  // Not reactive — only read/mutated imperatively.
  let autoScheduleProcessed = new Set<string>();

  // --- Audit log ---
  let auditLog = $state<AuditEntry[]>([]);
  let auditLogOpen = $state<boolean>(false);

  /**
   * Record one or more audit entries (newest shown first) and persist. Accepts
   * partial entries — id + timestamp are filled in. Fire-and-forget: a logging
   * failure must never break the action being logged.
   */
  function recordAudit(
    partials:
      | Parameters<typeof makeAuditEntry>[0]
      | Parameters<typeof makeAuditEntry>[0][],
  ): void {
    const list = Array.isArray(partials) ? partials : [partials];
    if (list.length === 0) return;
    const entries = list.map((p) => makeAuditEntry(p));
    auditLog = prependCapped(auditLog, entries);
    void saveAuditLog(auditLog);
  }

  let settingsDrawerOpen = $state<boolean>(false);

  // Quick-log popover visibility. Opens when the user clicks a date in the
  // heatmap or calendar grid; closes on backdrop click, the popover's own
  // close button, Escape, or after a successful submit/queue.
  let quickLogOpen = $state<boolean>(false);

  interface EditWorklog {
    id: string;
    issueKey: string;
    summary: string;
    hours: number;
    description: string;
    started?: string;
  }
  let editingWorklog = $state<EditWorklog | null>(null);

  // Optional "HH:mm" to prefill the form's Date Started time — set when adding
  // from an empty Day-timeline slot, cleared for every other entry point.
  let prefillStartedTime = $state<string | null>(null);

  function handleOpenQuickLog(): void {
    editingWorklog = null; // Ensure we're not in edit mode when opening via header
    prefillStartedTime = null;
    quickLogOpen = true;
  }

  function handleWorklogEdit(entry: WorklogEntry, date: string): void {
    if (!entry.id) return;
    editingWorklog = {
      id: entry.id,
      issueKey: entry.issueKey,
      summary: entry.summary ?? entry.issueKey,
      hours: entry.hours,
      description: entry.description,
      started: entry.started,
    };
    selectedDate = date;
    prefillStartedTime = null;
    quickLogOpen = true;
  }

  /**
   * Buang satu draf jadwal dari staging (tidak menyentuh Jira). Slot-nya
   * ditandai processed agar scheduler tidak menggenerate ulang — kegiatan
   * lain pada tanggal yang sama tidak terpengaruh.
   */
  function removeDraft(draftId: string): void {
    const draft = pendingDrafts[draftId];
    if (!draft) return;
    const rest = { ...pendingDrafts };
    delete rest[draftId];
    pendingDrafts = rest;
    autoScheduleProcessed.add(slotKey(draft.sourceActivityId, draft.sourceDate));
    saveProcessedSlots(autoScheduleProcessed).catch(() => {});
  }

  async function handleWorklogDelete(
    worklogId: string,
    issueKey: string,
    date: string,
  ): Promise<void> {
    // Entri draf belum ada di Jira — cukup dibuang dari staging.
    if (isDraftId(worklogId)) {
      removeDraft(worklogId);
      return;
    }

    if (!isCredentialComplete(credentials)) return;

    const prev = serverWorklogsByDate;

    // Optimistic delete — rebuild the day immutably so reactivity and the
    // cache stay consistent.
    const nextWorklogs = { ...serverWorklogsByDate } as Record<string, WorklogDay>;
    const day = nextWorklogs[date];
    if (day) {
      const entries = day.entries.filter((en) => en.id !== worklogId);
      nextWorklogs[date] = {
        totalHours: entries.reduce((sum, en) => sum + en.hours, 0),
        entries,
      };
      serverWorklogsByDate = nextWorklogs;
    }

    // Drop any staged edit for this worklog so it doesn't linger in the bar.
    if (pendingEdits[worklogId]) {
      const rest = { ...pendingEdits };
      delete rest[worklogId];
      pendingEdits = rest;
    }

    try {
      await invoke("delete_worklog", {
        baseUrl: credentials.baseUrl,
        email: credentials.email,
        apiToken: credentials.apiToken,
        isCloud,
        issueKey,
        worklogId,
      });
      // Persist the optimistic state to cache BEFORE the reconcile fetch.
      // Otherwise `fetchWorklogs`'s cache-hydration step repaints the stale
      // (pre-delete) state, making the deleted entry reappear — the same
      // gotcha handled in handleWorklogMoved.
      void writeCache(
        credentials.email,
        credentials.baseUrl,
        fetchStartDate,
        fetchEndDate,
        nextWorklogs,
      );
      void fetchWorklogs(true);
      recordAudit({
        action: "delete",
        source: "manual",
        status: "success",
        issueKey,
        date,
      });
    } catch (err) {
      // Restore the pre-delete state on failure.
      serverWorklogsByDate = prev;
      recordAudit({
        action: "delete",
        source: "manual",
        status: "failed",
        issueKey,
        date,
        message: err instanceof Error ? err.message : String(err),
      });
      alert(`Gagal menghapus logwork: ${err}`);
    }
  }

  // Marks completion of the initial parallel hydration so the refresh
  // `$effect` does not double-fetch on first mount.
  let initialMountDone = $state<boolean>(false);

  // ---------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------
  let credentialsComplete = $derived(isCredentialComplete(credentials));

  // ---------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------

  /** Read the persisted `isCloud` flag from `settings.json`; default true. */
  async function loadIsCloud(): Promise<boolean> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      return (await store.get<boolean>("isCloud")) ?? true;
    } catch {
      return true;
    }
  }

  /**
   * Extract plain text from a Jira worklog comment. Handles both legacy
   * string comments (Jira Server/DC) and modern ADF (Atlassian Document
   * Format) objects (Jira Cloud).
   */
  function extractCommentText(comment: any): string {
    if (!comment) return "";
    if (typeof comment === "string") return comment;

    // ADF handling: recursively find all "text" nodes.
    const texts: string[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (node.type === "text" && typeof node.text === "string") {
        texts.push(node.text);
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child);
      }
    };
    walk(comment);
    return texts.join(" ").trim();
  }

  /**
   * Fetch worklogs for the current heatmap range. Skipped when credentials
   * are incomplete (R15.7 — banner is shown instead). Aggregates results
   * across all returned issues.
   *
   * Caching strategy (stale-while-revalidate):
   *   1. Read the persisted cache for the current (email, baseUrl, range)
   *      key. If found, paint immediately so the heatmap is visible
   *      without waiting on the network.
   *   2. If the cached entry is "fresh" (< DEFAULT_FRESH_MS) and `force`
   *      is false, skip the network call entirely.
   *   3. Otherwise, run the network fetch in the background and update
   *      both UI state and cache when it returns.
   *
   * `force` (true on user-driven retries / submits / sync ticks) bypasses
   * the freshness window and always hits the network.
   */
  async function fetchWorklogs(force: boolean = false): Promise<void> {
    if (!isCredentialComplete(credentials)) {
      serverWorklogsByDate = {};
      worklogsLoading = false;
      worklogsError = null;
      return;
    }

    const cacheArgs = {
      email: credentials.email,
      baseUrl: credentials.baseUrl,
      startDate: fetchStartDate,
      endDate: fetchEndDate,
    } as const;

    // -- Step 1: hydrate from cache (if any) ------------------------------
    // Only paint from cache when nothing is on screen yet. Repainting over
    // existing state would clobber an optimistic update — a just-submitted
    // worklog would vanish and only reappear when the (multi-request)
    // reconcile lands, which reads as "sync is slow".
    const hasVisibleData = Object.keys(serverWorklogsByDate).length > 0;
    let servedFromCache = hasVisibleData;
    try {
      const hit = await readCache(
        cacheArgs.email,
        cacheArgs.baseUrl,
        cacheArgs.startDate,
        cacheArgs.endDate,
      );
      if (hit) {
        if (!hasVisibleData) {
          serverWorklogsByDate = hit.entry.worklogsByDate;
          worklogsError = null;
          worklogsLoading = false;
          servedFromCache = true;
        }
        // Step 2: skip the network when cache is fresh and no force.
        if (hit.fresh && !force) return;
      }
    } catch {
      /* cache failures fall through to the network */
    }

    // -- Step 3: network revalidation ------------------------------------
    // When we have nothing on screen yet, show the spinner. When something
    // is already painted, leave `worklogsLoading=false` so the UI doesn't
    // flicker; the refresh happens silently.
    if (!servedFromCache) {
      worklogsLoading = true;
    }
    worklogsError = null;

    try {
      const raw: string = await invoke("get_my_worklogs", {
        baseUrl: credentials.baseUrl,
        email: credentials.email,
        apiToken: credentials.apiToken,
        isCloud,
        startDate: fetchStartDate,
        endDate: fetchEndDate,
      });
      const data = JSON.parse(raw);
      const issues = Array.isArray(data?.issues) ? data.issues : [];

      interface JiraWorklog {
        id?: string;
        author?: { emailAddress?: string };
        started?: string;
        timeSpentSeconds?: number;
        comment?: any;
      }

      const combined: Record<string, WorklogDay> = {};
      for (const issue of issues) {
        const issueKey: string = issue?.key ?? "";
        const summary: string = issue?.fields?.summary ?? "";
        const all: JiraWorklog[] = issue?.fields?.worklog?.worklogs ?? [];
        // Backend (`get_my_worklogs`) already filters by the authenticated
        // user via /myself (accountId/key/name + email fallback), so we
        // trust the response here. This is important on Jira Cloud where
        // `author.emailAddress` may be hidden by privacy settings — a
        // strict client-side email match would otherwise drop legitimate
        // entries owned by the current user.
        for (const wl of all) {
          if (!wl.started) continue;
          const date = wl.started.substring(0, 10);
          if (date < fetchStartDate || date > fetchEndDate) continue;
          const seconds = Number(wl.timeSpentSeconds ?? 0);
          if (!Number.isFinite(seconds) || seconds <= 0) continue;
          const hours = seconds / 3600;
          if (!combined[date]) {
            combined[date] = { totalHours: 0, entries: [] };
          }
          combined[date].totalHours += hours;
          const commentText = extractCommentText(wl.comment);
          combined[date].entries.push({
            id: wl.id,
            issueKey,
            hours,
            started: wl.started,
            timeSpentSeconds: seconds,
            description: commentText,
            summary: summary,
          });
        }
      }
      serverWorklogsByDate = combined;
      // Persist in the background; failures are swallowed inside writeCache.
      void writeCache(
        cacheArgs.email,
        cacheArgs.baseUrl,
        cacheArgs.startDate,
        cacheArgs.endDate,
        combined,
      );
    } catch (err) {
      // If we already painted from cache, keep showing it and surface a
      // non-blocking error. Otherwise, replace the heatmap with the error
      // state so the user can retry.
      if (!servedFromCache) {
        worklogsError =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Could not load worklogs.";
      }
    } finally {
      worklogsLoading = false;
    }
  }

  /**
   * Run the three initial loads in parallel:
   *   - workspace settings (R10.1 / R10.2 source)
   *   - credentials + isCloud (R14.6)
   *   - recent issues cache (R14.3 / R14.4)
   * Then, if credentials are complete, fetch worklogs (R5.8). Failures on
   * any individual load fall back to safe defaults.
   */
  async function initWorkspace(): Promise<void> {
    const [settingsP, isCloudP, credsP, recentsP, autoSchedP, processedP, auditP] =
      await Promise.allSettled([
        loadWorkspaceSettings(),
        loadIsCloud(),
        loadCredentials(),
        loadRecentIssues(email),
        loadAutoScheduleConfig(),
        loadProcessedSlots(),
        loadAuditLog(),
      ]);

    if (autoSchedP.status === "fulfilled") {
      autoScheduleConfig = autoSchedP.value;
    }
    if (processedP.status === "fulfilled") {
      autoScheduleProcessed = processedP.value;
    }
    if (auditP.status === "fulfilled") {
      auditLog = auditP.value;
    }

    if (settingsP.status === "fulfilled") {
      workspaceSettings = settingsP.value;
    } else {
      workspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS };
    }

    if (isCloudP.status === "fulfilled") {
      isCloud = isCloudP.value;
    }

    if (credsP.status === "fulfilled") {
      credentials = credsP.value;
    }

    if (recentsP.status === "fulfilled") {
      recentIssues = recentsP.value;
      recentIssuesReady = true;
      recentIssuesError = null;
    } else {
      // R14.4 — Submit stays disabled and an inline error is shown.
      recentIssuesReady = false;
      const reason = recentsP.reason;
      recentIssuesError =
        reason instanceof Error
          ? `Couldn't load recent issues: ${reason.message}`
          : "Couldn't load recent issues.";
    }

    if (isCredentialComplete(credentials)) {
      // Force a fresh fetch on first mount: this surfaces any worklogs
      // logged on the server since the last session and ensures a
      // post-logout/login cycle never paints stale data from a previous
      // user. Subsequent refreshes (range change, etc.) still go through
      // the cache fast-path.
      await fetchWorklogs(true);
      // Server truth is loaded — safe to generate schedule drafts (the
      // per-day dup-check reads `serverWorklogsByDate`).
      generateScheduleDrafts();
    } else {
      // Skip worklog fetch — banner is shown (R15.7).
      worklogsLoading = false;
    }

    initialMountDone = true;
  }

  // Run the initial hydration once on mount. The async callback is awaited
  // outside the synchronous effect body so reactive state read inside it is
  // not tracked, and the effect therefore does not re-run when `credentials`
  // or other state changes during init.
  $effect(() => {
    void initWorkspace();
  });

  // Background sync subscription (R15.6). The offlineStore exposes no
  // subscription mechanism, so we drain the queue on an interval.
  //
  // A forced refetch costs one request per issue in the window (~20 for a
  // two-month range) on top of /myself + the JQL search. Running that every
  // 15 s kept the connection permanently busy and made user-initiated
  // submits queue behind background traffic. The queue is empty in the
  // common case, so we only force a refetch when something actually drained;
  // otherwise we do a cache-respecting fetch, which no-ops while the cache
  // is fresh. The user's own actions (submit/delete/discard) still force
  // their own reconcile, so their changes never wait on this tick.
  $effect(() => {
    if (!credentialsComplete) return;
    const id = window.setInterval(async () => {
      let synced = 0;
      try {
        ({ synced } = await syncPendingWorklogs());
      } catch {
        /* ignore — still revalidate below */
      }
      void fetchWorklogs(synced > 0);
    }, 60000);
    return () => window.clearInterval(id);
  });

  // Auto-schedule tick. Re-checks every 10 minutes so a day rollover while
  // the app stays open still yields fresh drafts. Idempotent —
  // generateScheduleDrafts dedups already-generated / processed days.
  $effect(() => {
    if (!credentialsComplete || !autoScheduleConfig.enabled) return;
    const id = window.setInterval(() => {
      generateScheduleDrafts();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  });

  // Global Escape key — closes the quick-log popover when it is open. The
  // overlay element also handles Escape, but this guard catches the case
  // where focus has briefly left the dialog (e.g. select dropdowns).
  $effect(() => {
    if (!quickLogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") quickLogOpen = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------

  function handleOpenSettings(): void {
    settingsDrawerOpen = true;
  }

  function handleCloseSettings(): void {
    settingsDrawerOpen = false;
  }

  function handleOpenAuditLog(): void {
    auditLogOpen = true;
  }

  function handleCloseAuditLog(): void {
    auditLogOpen = false;
  }

  async function handleClearAuditLog(): Promise<void> {
    auditLog = [];
    await clearAuditLog();
  }

  function handleSelectDate(date: string): void {
    // Selecting a date just moves the shared selection (the calendar drills
    // into the Day view itself). The Log Work popover now opens explicitly via
    // the per-cell "+" button (handleAddWorklog), not on plain selection.
    selectedDate = date;
  }

  /** Open the Log Work form for a specific day, without leaving the current
   *  view. Always a fresh add (not an edit). An optional "HH:mm" prefills the
   *  start time (used when clicking an empty slot in the Day timeline). */
  function handleAddWorklog(date: string, startedTime?: string): void {
    selectedDate = date;
    editingWorklog = null;
    prefillStartedTime = startedTime ?? null;
    quickLogOpen = true;
  }

  function handleCloseQuickLog(): void {
    quickLogOpen = false;
    editingWorklog = null;
  }

  /**
   * Worklog submitted online. Apply optimistic update (R5.10), upsert recent
   * issues (R6.5), persist (R14.2), and trigger background refresh.
   */
  async function handleWorklogSubmitted(e: {
    issueKey: string;
    summary: string;
    hours: number;
    date: string;
    description: string;
    started?: string;
  }): Promise<void> {
    // Edit terhadap draf jadwal (QuickLogCard mode lokal): perbarui draf di
    // staging saja — belum ada yang menyentuh Jira sampai "Submit changes".
    if (editingWorklog && isDraftId(editingWorklog.id)) {
      const draft = pendingDrafts[editingWorklog.id];
      if (draft) {
        pendingDrafts = {
          ...pendingDrafts,
          [editingWorklog.id]: {
            ...draft,
            issueKey: e.issueKey,
            summary: e.summary,
            hours: e.hours,
            description: e.description,
            started: e.started || jiraStarted(e.date),
          },
        };
      }
      quickLogOpen = false;
      editingWorklog = null;
      return;
    }

    // 1. Optimistic Update: Add to local state immediately
    const entry: WorklogEntry = {
      issueKey: e.issueKey,
      summary: e.summary,
      hours: e.hours,
      description: e.description,
      started: e.started || jiraStarted(e.date),
    };

    const nextWorklogs = { ...serverWorklogsByDate };
    if (!nextWorklogs[e.date]) {
      nextWorklogs[e.date] = { totalHours: 0, entries: [] };
    }
    // If we're updating (editingWorklog is set), replace the old one
    if (editingWorklog && e.date === selectedDate) {
      nextWorklogs[e.date].entries = nextWorklogs[e.date].entries.filter(en => en.id !== editingWorklog?.id);
    }

    nextWorklogs[e.date].entries.push(entry);
    // Re-calculate total hours for that day
    nextWorklogs[e.date].totalHours = nextWorklogs[e.date].entries.reduce((sum, en) => sum + en.hours, 0);
    serverWorklogsByDate = nextWorklogs;

    // 2. Recent Issues Update
    const nextRecent = upsertRecentIssue(recentIssues, {
      issueKey: e.issueKey,
      summary: e.summary,
    });
    recentIssues = nextRecent;
    try {
      await saveRecentIssues(email, nextRecent);
    } catch { /* silent */ }

    // 3. Audit trail — capture whether this was an edit before clearing state.
    recordAudit({
      action: editingWorklog ? "edit" : "add",
      source: "manual",
      status: "success",
      issueKey: e.issueKey,
      date: e.date,
      hours: e.hours,
    });

    // 4. UI Feedback: Close immediately
    quickLogOpen = false;
    editingWorklog = null;

    // 5. Background Refresh: No spinner, just sync truth from Jira
    void fetchWorklogs(true);
  }

  /**
   * Worklog enqueued for offline sync. Upsert + persist (R15.5). Skip the
   * fetch refresh — the heatmap doesn't yet reflect the queued entry, and
   * the next sync cycle will trigger a refresh via the interval above.
   */
  async function handleWorklogQueued(e: {
    issueKey: string;
    summary: string;
    hours: number;
    date: string;
  }): Promise<void> {
    const next = upsertRecentIssue(recentIssues, {
      issueKey: e.issueKey,
      summary: e.summary,
    });
    recentIssues = next;
    try {
      await saveRecentIssues(email, next);
    } catch {
      /* persistence failures here don't block UI updates */
    }
    recordAudit({
      action: "add",
      source: "manual",
      status: "queued",
      issueKey: e.issueKey,
      date: e.date,
      hours: e.hours,
      message: "Antre untuk sinkronisasi offline.",
    });
    // Auto-dismiss the popover for symmetry with the online success path.
    window.setTimeout(() => {
      quickLogOpen = false;
      editingWorklog = null;
    }, 900);
  }

  function handleSettingsSaved(next: WorkspaceSettings): void {
    workspaceSettings = next;
    settingsDrawerOpen = false;
  }

  function handleCredentialsSaved(
    next: Credentials,
    nextIsCloud: boolean,
  ): void {
    credentials = next;
    isCloud = nextIsCloud;
    // New / updated credentials may unblock the worklog fetch — force a
    // network revalidation so we don't paint stale data from a different
    // user's previous session.
    void fetchWorklogs(true);
  }

  // ---------------------------------------------------------------------
  // Auto-schedule runtime
  // ---------------------------------------------------------------------

  /** Local tz offset formatted "+0700" / "-0500" for the Jira `started` field. */
  function autoLocalOffset(): string {
    const minutesEast = -new Date().getTimezoneOffset();
    const sign = minutesEast >= 0 ? "+" : "-";
    const abs = Math.abs(minutesEast);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}${mm}`;
  }

  /** Build a Jira `started` ISO string for a scheduled activity on `date`. */
  function autoStarted(date: string, time: string): string {
    const t = (time && /^\d{2}:\d{2}/.test(time) ? time : "09:00").slice(0, 5);
    return `${date}T${t}:00.000${autoLocalOffset()}`;
  }

  /** Best-effort desktop notification: draf terjadwal siap direview. */
  async function notifyDraftsReady(count: number, days: number): Promise<void> {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) return;
      const dayLabel = days > 1 ? ` untuk ${days} hari` : "";
      sendNotification({
        title: "Draf worklog terjadwal",
        body: `${count} draf worklog siap direview${dayLabel} — periksa lalu submit.`,
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  /**
   * Generate draf worklog dari jadwal otomatis — menggantikan auto-log
   * langsung ke Jira. Setiap slot (kegiatan × tanggal) yang eligible menjadi
   * sebuah `PendingDraft` yang tampil di kalender agar user bisa memeriksa /
   * mengubah / menghapusnya dulu. Tidak ada yang dikirim ke Jira di sini;
   * pengiriman terjadi saat user menekan "Submit changes", dan slot ditandai
   * processed saat itu (atau saat draf-nya dibuang user).
   *
   * Idempotent lewat tiga lapis, semuanya per-slot: draf yang sedang
   * distaging, `processed` (persisted), dan cek worklog serupa yang sudah
   * ada di server pada hari itu.
   */
  function generateScheduleDrafts(): void {
    if (!autoScheduleConfig.enabled) return;
    if (!isCredentialComplete(credentials)) return;

    const slots = computeEligibleSlots({
      today: toYMD(new Date()),
      config: autoScheduleConfig,
      processed: autoScheduleProcessed,
      isHoliday,
    });
    if (slots.length === 0) return;

    // Slot yang draf-nya sedang distaging — jangan digenerate ulang oleh
    // tick berkala. `sourceDate` tetap tanggal jadwal asal walau draf-nya
    // sudah digeser user ke hari lain.
    const staged = new Set(
      Object.values(pendingDrafts).map((d) => slotKey(d.sourceActivityId, d.sourceDate)),
    );

    const additions: Record<string, PendingDraft> = {};
    const affectedDates = new Set<string>();
    let processedChanged = false;

    for (const { date, activity } of slots) {
      const key = slotKey(activity.id, date);
      if (staged.has(key)) continue;

      // Worklog serupa sudah ada di Jira hari itu (entri manual / submit
      // sebelumnya) → tidak perlu direview; tandai slot selesai.
      const existing = serverWorklogsByDate[date]?.entries ?? [];
      const dup = existing.some(
        (e) =>
          e.issueKey === activity.issueKey &&
          Math.abs(e.hours - activity.hours) < 0.001,
      );
      if (dup) {
        autoScheduleProcessed.add(key);
        processedChanged = true;
        continue;
      }

      const draftId = newDraftId();
      additions[draftId] = {
        draftId,
        sourceActivityId: activity.id,
        sourceDate: date,
        issueKey: activity.issueKey,
        summary: activity.summary,
        hours: activity.hours,
        description: activity.description ?? "",
        started: autoStarted(date, activity.startTime),
      };
      affectedDates.add(date);
    }

    if (processedChanged) {
      saveProcessedSlots(autoScheduleProcessed).catch(() => {});
    }

    const count = Object.keys(additions).length;
    if (count === 0) return;
    pendingDrafts = { ...pendingDrafts, ...additions };
    void notifyDraftsReady(count, affectedDates.size);
  }

  function handleAutoScheduleSaved(next: AutoScheduleConfig): void {
    autoScheduleConfig = next;
    // Enabling / editing may make today eligible right now — generate the
    // review drafts immediately.
    generateScheduleDrafts();
  }
</script>

<AnimatedBackground />

<div class="workspace-shell">
  <div class="workspace-grid">
    <!-- Header (full width) -->
    <div class="col-span-12">
      <WorkspaceHeader
        {displayName}
        {email}
        onOpenSettings={handleOpenSettings}
        onOpenAuditLog={handleOpenAuditLog}
        {onLogout}
      />
    </div>

    <!-- Credentials banner (full width, only when incomplete) -->
    {#if !credentialsComplete}
      <div class="col-span-12">
        <CredentialsBanner
          show={true}
          onOpenSettings={handleOpenSettings}
        />
      </div>
    {/if}

    <!-- Weekly summary (full width) — moved above the calendar so the
         current week's hours and target progress are visible without
         scrolling. -->
    <div class="col-span-12">
      <WeeklySummary
        {worklogsByDate}
        targetHours={workspaceSettings.targetHours}
        isLoading={worklogsLoading}
        {today}
        mode={summaryMode}
        cursorDate={calCursorDate}
      />
    </div>

    <!-- Calendar grid (full width) — view per hari/minggu/bulan -->
    <div class="col-span-12">
      <CalendarGrid
        {worklogsByDate}
        selectedDate={selectedDate ?? todayStr}
        isLoading={worklogsLoading}
        onSelectDate={handleSelectDate}
        baseUrl={credentials.baseUrl}
        onModeChange={handleCalendarModeChange}
        onCursorChange={handleCalendarCursorChange}
        onWorklogMoved={handleWorklogMoved}
        onWorklogEdit={handleWorklogEdit}
        onWorklogDelete={handleWorklogDelete}
        onAddWorklog={handleAddWorklog}
        onWorklogReschedule={handleWorklogReschedule}
      />
    </div>
  </div>
</div>

<!-- Staged-changes bar: appears while calendar drag/resize/move edits or
     draf jadwal otomatis are pending, letting the user commit them all to
     Jira at once or discard. -->
{#if pendingCount > 0}
  <div
    class="pending-bar glass glass-overlay"
    role="region"
    aria-label="Perubahan kalender belum disimpan"
  >
    <div class="pending-info">
      <svg
        class="pending-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4l3 2" />
      </svg>
      <span>{pendingLabel}</span>
    </div>

    {#if submitChangesError}
      <span class="pending-error" role="alert">{submitChangesError}</span>
    {/if}

    <div class="pending-actions">
      <button
        type="button"
        class="pending-discard"
        onclick={discardPendingChanges}
        disabled={submittingChanges}
      >
        Discard
      </button>
      <button
        type="button"
        class="pending-submit"
        onclick={submitPendingChanges}
        disabled={submittingChanges}
        aria-busy={submittingChanges}
      >
        {#if submittingChanges}
          <span class="spinner" aria-hidden="true"></span>
          <span>Menyimpan…</span>
        {:else}
          <span>Submit changes ({pendingCount})</span>
        {/if}
      </button>
    </div>
  </div>
{/if}

<!-- Quick log popover. Mounted only while open so the QuickLogCard's
     internal state resets between sessions and the form is fresh on
     each click. -->
{#if quickLogOpen}
  <div
    class="quick-log-overlay"
    role="presentation"
    onclick={handleCloseQuickLog}
    onkeydown={(e) => {
      if (e.key === "Escape") handleCloseQuickLog();
    }}
  >
    <div
      class="quick-log-popover"
      role="dialog"
      aria-modal="true"
      aria-label="Log work"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <QuickLogCard
        {recentIssues}
        {recentIssuesReady}
        {recentIssuesError}
        selectedDate={selectedDate ?? todayStr}
        email={credentials.email || email}
        baseUrl={credentials.baseUrl}
        apiToken={credentials.apiToken}
        {isCloud}
        editWorklog={editingWorklog}
        localEdit={!!editingWorklog && isDraftId(editingWorklog.id)}
        initialStartedTime={prefillStartedTime}
        onWorklogSubmitted={handleWorklogSubmitted}
        onWorklogQueued={handleWorklogQueued}
        onCancelEdit={handleCloseQuickLog}
      />
    </div>
  </div>
{/if}

<!-- Settings drawer overlay -->
<SettingsDrawer
  open={settingsDrawerOpen}
  initialSettings={workspaceSettings}
  initialCredentials={credentials}
  initialIsCloud={isCloud}
  initialAutoSchedule={autoScheduleConfig}
  onClose={handleCloseSettings}
  onSettingsSaved={handleSettingsSaved}
  onCredentialsSaved={handleCredentialsSaved}
  onAutoScheduleSaved={handleAutoScheduleSaved}
/>

<!-- Audit log overlay -->
<AuditLogPanel
  open={auditLogOpen}
  entries={auditLog}
  onClose={handleCloseAuditLog}
  onClear={handleClearAuditLog}
/>

<style>
  .workspace-shell {
    /* Sit above the AnimatedBackground (which is fixed at z-index: 0). */
    position: relative;
    z-index: 1;
    height: 100vh;
    width: 100%;
    padding: 0.75rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .workspace-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    margin: 0;
  }

  /* Each section grows to fit the available space, with the calendar taking the most. */
  .col-span-12 {
    width: 100%;
    min-height: 0;
  }

  .col-span-12:last-child {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* --- Quick log popover ---------------------------------------------- */

  .quick-log-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4rem 1rem 1rem;
    background: rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    overflow-y: auto;
    animation: overlay-fade-in 160ms ease-out;
  }

  .quick-log-popover {
    position: relative;
    width: 100%;
    max-width: 28rem;
    animation: popover-pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  @keyframes overlay-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  @keyframes popover-pop-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .quick-log-overlay,
    .quick-log-popover {
      animation: none;
    }
  }

  /* --- Staged-changes bar --------------------------------------------- */

  .pending-bar {
    position: fixed;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: calc(100vw - 2rem);
    padding: 0.625rem 0.75rem 0.625rem 1rem;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.6);
    animation: pending-bar-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pending-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #f1f5f9;
    white-space: nowrap;
  }

  .pending-icon {
    width: 1.125rem;
    height: 1.125rem;
    color: #fcd34d;
    flex-shrink: 0;
  }

  .pending-error {
    font-size: 0.8125rem;
    color: #fca5a5;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pending-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .pending-discard,
  .pending-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4375rem;
    padding: 0.5rem 0.875rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      opacity 0.2s ease-out,
      background 0.2s ease-out,
      box-shadow 0.2s ease-out;
    outline: none;
  }

  .pending-discard {
    border: 1px solid var(--glass-border);
    background: var(--glass-bg-strong);
    color: rgba(255, 255, 255, 0.85);
  }

  .pending-discard:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .pending-submit {
    border: none;
    color: #fff;
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
  }

  .pending-submit:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
  }

  .pending-discard:focus-visible,
  .pending-submit:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .pending-discard:disabled,
  .pending-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pending-submit .spinner {
    width: 0.875rem;
    height: 0.875rem;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes pending-bar-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pending-bar {
      animation: none;
    }
    .pending-submit .spinner {
      animation: none;
    }
  }
</style>
