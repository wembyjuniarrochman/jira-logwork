<script lang="ts">
  /**
   * QuickLogCard
   *
   * The composite worklog-entry surface that lets a user pick a recent issue
   * (or search for a new one), choose hours via preset chips or a custom
   * input, optionally add a description, and submit. Online happy-path calls
   * `add_worklog`; on a network error the entry is enqueued via
   * `addPendingWorklog` and the user sees a "Queued for sync" confirmation.
   *
   * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.7, 7.1, 8.1–8.7, 9.1–9.8,
   *            11.6, 12.1, 12.3, 13.7, 15.2, 15.3, 15.4
   */

  import { invoke } from "@tauri-apps/api/core";
  import RecentIssuesList from "./RecentIssuesList.svelte";
  import UniversalSearch from "./UniversalSearch.svelte";
  import TimePresetChips from "./TimePresetChips.svelte";
  import DescriptionEditor from "./DescriptionEditor.svelte";
  import type { RecentIssue } from "../stores/recentIssuesStore";
  import {
    canSubmit,
    chipReducer,
    isValidCustomHours,
    isValidDescription,
    type ChipState,
    type ChipValue,
    type SubmitState,
    type SelectedIssue,
  } from "../stores/quickLogReducer";
  import { secondsForHours, jiraStarted } from "../stores/settingsStore";
  import { classifyError } from "../stores/authStore";
  import { addPendingWorklog } from "../stores/offlineStore";
  import { fetchProjects, type JiraProject } from "../stores/searchStore";
  import { tick } from "svelte";

  interface WorklogEvent {
    issueKey: string;
    summary: string;
    hours: number;
    date: string;
    description: string;
    started?: string;
  }

  interface Props {
    recentIssues: RecentIssue[];
    recentIssuesReady: boolean;
    recentIssuesError: string | null;
    selectedDate: string;
    email: string;
    baseUrl: string;
    apiToken: string;
    isCloud: boolean;
    /** Optional worklog to edit. If provided, the card switches to update mode. */
    editWorklog?: {
      id: string;
      issueKey: string;
      summary: string;
      hours: number;
      description: string;
      started?: string;
    } | null;
    /** True saat `editWorklog` adalah draf lokal (belum ada di Jira, mis.
     *  draf jadwal otomatis): submit tidak memanggil API — nilai hasil edit
     *  dikembalikan lewat `onWorklogSubmitted` dan parent memperbarui
     *  staging-nya. */
    localEdit?: boolean;
    /** Optional "HH:mm" to prefill Date Started when adding a fresh worklog
     *  (e.g. from clicking an empty Day-timeline slot). Ignored when editing. */
    initialStartedTime?: string | null;
    onWorklogSubmitted: (e: WorklogEvent) => void;
    onWorklogQueued: (e: WorklogEvent) => void;
    onCancelEdit?: () => void;
  }

  let {
    recentIssues,
    recentIssuesReady,
    recentIssuesError,
    selectedDate,
    email,
    baseUrl,
    apiToken,
    isCloud,
    editWorklog = null,
    localEdit = false,
    initialStartedTime = null,
    onWorklogSubmitted,
    onWorklogQueued,
    onCancelEdit,
  }: Props = $props();

  // --- Form state ---

  let selectedIssue = $state<SelectedIssue | null>(null);

  // Sync state when editWorklog changes
  $effect(() => {
    if (editWorklog) {
      selectedIssue = {
        key: editWorklog.issueKey,
        summary: editWorklog.summary,
      };
      description = editWorklog.description;
      // Prefill Date Started from the worklog being edited (preserving its
      // original date + time-of-day); fall back to the selected day at 09:00.
      if (editWorklog.started && editWorklog.started.length >= 16) {
        startedDate = editWorklog.started.slice(0, 10);
        startedTime = editWorklog.started.slice(11, 16);
      } else {
        startedDate = selectedDate;
        startedTime = "09:00";
      }
      const h = editWorklog.hours;
      // If h is one of the chips (0.5, 1, 2, 4, 8), select that chip
      if ([0.5, 1, 2, 4, 8].includes(h)) {
        chipState = { chipHours: h as ChipValue, customHours: null };
        customHoursText = "";
      } else {
        chipState = { chipHours: null, customHours: h };
        customHoursText = h.toString();
      }
    } else {
      // Reset to defaults when not editing
      selectedIssue = null;
      description = "";
      startedDate = selectedDate;
      startedTime = initialStartedTime ?? "09:00";
      chipState = { chipHours: 1, customHours: null };
      customHoursText = "";
    }
  });

  // The chip group + custom-hours pair is a single unit of state managed by
  // chipReducer to preserve the radio invariant (R8.4 / Property 15).
  // Default chipHours = 1 on first render (R8.6).
  let chipState = $state<ChipState>({ chipHours: 1, customHours: null });

  // The text bound to the custom-hours input. We track this separately from
  // chipState.customHours so the user can clear the field without
  // round-tripping through "0" or NaN.
  let customHoursText = $state<string>("");

  let description = $state<string>("");

  // Date Started — explicit date (YYYY-MM-DD) + time (HH:mm) the user can set,
  // mirroring Jira's "Date started" field. Combined into the ISO `started`
  // string on submit. Defaults track the selected calendar day (R: new field).
  let startedDate = $state<string>("");
  let startedTime = $state<string>("09:00");

  let submitState = $state<SubmitState>("idle");
  let submitError = $state<string | null>(null);

  // --- Project picker state ---

  let selectedProject = $state<JiraProject | null>(null);
  let projects = $state<JiraProject[]>([]);
  let projectsLoaded = $state<boolean>(false);
  let projectsLoading = $state<boolean>(false);
  let projectsError = $state<string | null>(null);

  // Combobox UI state.
  let projectQuery = $state<string>("");
  let projectOpen = $state<boolean>(false);
  let projectActiveIndex = $state<number>(0);
  let projectInputEl: HTMLInputElement | null = $state(null);
  let projectListboxEl: HTMLUListElement | null = $state(null);

  /** Lazy-fetch the project list. Cached in `projects`/`projectsLoaded`
   *  so reopening the combobox doesn't refetch. Errors are captured
   *  separately so the user can see them inline without breaking the form. */
  async function ensureProjectsLoaded(): Promise<void> {
    if (projectsLoaded || projectsLoading) return;
    projectsLoading = true;
    projectsError = null;
    try {
      const list = await fetchProjects({ baseUrl, email, apiToken, isCloud });
      // Sort by name (case-insensitive) so the picker is predictable.
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      projects = list;
      projectsLoaded = true;
    } catch (err) {
      projectsError =
        err instanceof Error
          ? `Gagal memuat daftar project: ${err.message}`
          : "Gagal memuat daftar project.";
    } finally {
      projectsLoading = false;
    }
  }

  // Filtered list of projects matching the type-ahead query (case-insensitive
  // against both key and name). Empty query → show all projects.
  let filteredProjects = $derived.by<JiraProject[]>(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.key.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    );
  });

  async function openProjectPicker(): Promise<void> {
    projectOpen = true;
    projectActiveIndex = 0;
    await ensureProjectsLoaded();
  }

  function closeProjectPicker(): void {
    projectOpen = false;
  }

  function chooseProject(p: JiraProject | null): void {
    selectedProject = p;
    projectQuery = "";
    projectOpen = false;
    // Clear the currently selected issue if it doesn't belong to the new
    // scope — avoids submitting a worklog against a key that's no longer
    // visible in the search list.
    if (p && selectedIssue && !selectedIssue.key.startsWith(`${p.key}-`)) {
      selectedIssue = null;
    }
  }

  function onProjectInput(event: Event): void {
    projectQuery = (event.currentTarget as HTMLInputElement).value;
    projectOpen = true;
    projectActiveIndex = 0;
    void ensureProjectsLoaded();
  }

  async function onProjectKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!projectOpen) await openProjectPicker();
      const max = filteredProjects.length - 1;
      projectActiveIndex = Math.min(projectActiveIndex + 1, max < 0 ? 0 : max);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      projectActiveIndex = Math.max(0, projectActiveIndex - 1);
    } else if (event.key === "Enter") {
      if (projectOpen && filteredProjects[projectActiveIndex]) {
        event.preventDefault();
        chooseProject(filteredProjects[projectActiveIndex]);
      }
    } else if (event.key === "Escape") {
      if (projectOpen) {
        event.preventDefault();
        projectOpen = false;
      }
    }
  }

  // Close the dropdown on outside click. We register a window listener only
  // while the dropdown is open so it cleans up cleanly when closed.
  $effect(() => {
    if (!projectOpen) return;
    const onWindowMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        projectInputEl &&
        !projectInputEl.contains(target) &&
        projectListboxEl &&
        !projectListboxEl.contains(target)
      ) {
        projectOpen = false;
      }
    };
    window.addEventListener("mousedown", onWindowMouseDown, true);
    return () => window.removeEventListener("mousedown", onWindowMouseDown, true);
  });

  // --- Derived ---

  const effectiveHours = $derived(
    chipState.customHours ?? chipState.chipHours ?? 0,
  );

  const canSubmitNow = $derived(
    canSubmit({
      recentIssuesReady,
      selectedIssue,
      effectiveHours,
      submitState,
    }),
  );

  // Keep description capped at 500 characters defensively (R8.5). The
  // textarea also has `maxlength=500`, so this is belt-and-suspenders.
  const descriptionValid = $derived(isValidDescription(description));

  // --- Selection sources ---

  function handleRecentSelect(issue: RecentIssue) {
    selectedIssue = { key: issue.issueKey, summary: issue.summary };
    submitState = "idle";
    submitError = null;
  }

  function handleSearchSelect(result: { key: string; summary: string }) {
    selectedIssue = { key: result.key, summary: result.summary };
    submitState = "idle";
    submitError = null;
  }

  // --- Chip / custom-hours handlers ---

  function handleChipChange(value: ChipValue) {
    chipState = chipReducer(chipState, { type: "chipClick", value });
    customHoursText = "";
  }

  function handleCustomHoursInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const raw = target.value;
    customHoursText = raw;

    if (raw.trim() === "") {
      chipState = chipReducer(chipState, { type: "customHours", value: null });
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !isValidCustomHours(parsed)) {
      // Leave chipState as-is; only commit when the value is valid so partial
      // typing does not deselect the current chip.
      return;
    }

    chipState = chipReducer(chipState, { type: "customHours", value: parsed });
  }

  // --- Submission ---

  let successResetTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedResetTimer: ReturnType<typeof setTimeout> | null = null;

  function clearResetTimers() {
    if (successResetTimer !== null) {
      clearTimeout(successResetTimer);
      successResetTimer = null;
    }
    if (queuedResetTimer !== null) {
      clearTimeout(queuedResetTimer);
      queuedResetTimer = null;
    }
  }

  /**
   * Local timezone offset formatted as Jira expects ("+0700" / "-0500"), so a
   * wall-clock time the user types round-trips: Jira stores it, and the
   * calendar (which renders via `new Date(started)`) shows the same hour.
   */
  function localOffset(): string {
    const minutesEast = -new Date().getTimezoneOffset();
    const sign = minutesEast >= 0 ? "+" : "-";
    const abs = Math.abs(minutesEast);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}${mm}`;
  }

  /**
   * Pure: build a Jira `started` ISO 8601 string from the user-chosen date +
   * time. When editing, reuse the worklog's original timezone offset so we
   * don't shift it; otherwise use the machine's local offset.
   */
  function buildStarted(
    dateStr: string,
    timeStr: string,
    sourceStarted: string | undefined,
  ): string {
    if (!dateStr) return jiraStarted(selectedDate);
    const time = (timeStr || "09:00").slice(0, 5);
    // Original offset is the trailing "+0700" / "-0500" / "Z" of the source.
    const offsetMatch = sourceStarted?.match(/(Z|[+-]\d{2}:?\d{2})$/);
    const offset = offsetMatch ? offsetMatch[0].replace(":", "") : localOffset();
    return `${dateStr}T${time}:00.000${offset === "Z" ? "+0000" : offset}`;
  }

  async function handleSubmit() {
    if (!canSubmitNow || selectedIssue === null) {
      return;
    }

    clearResetTimers();
    submitError = null;
    submitState = "submitting";

    const issueKey = selectedIssue.key;
    const summary = selectedIssue.summary;
    const hours = effectiveHours;
    // The worklog lands on the user-chosen Date Started, not just the calendar
    // day, so the optimistic UI update and Jira agree.
    const date = startedDate || selectedDate;
    const timeSpentSeconds = secondsForHours(hours);
    const started = buildStarted(startedDate, startedTime, editWorklog?.started);
    const comment = description;

    // Edit draf lokal: tidak ada panggilan Jira — kembalikan nilainya ke
    // parent, yang memperbarui draf di staging-nya sendiri.
    if (editWorklog && localEdit) {
      onWorklogSubmitted({ issueKey, summary, hours, date, description: comment, started });
      submitState = "success";
      successResetTimer = setTimeout(() => {
        if (submitState === "success") submitState = "idle";
        successResetTimer = null;
      }, 2000);
      return;
    }

    try {
      if (editWorklog) {
        // If the issue key changed, we must delete from old and add to new,
        // because Jira worklog IDs are tied to their parent issue.
        if (editWorklog.issueKey !== issueKey) {
          await invoke("delete_worklog", {
            baseUrl,
            email,
            apiToken,
            isCloud,
            issueKey: editWorklog.issueKey,
            worklogId: editWorklog.id,
          });
          await invoke("add_worklog", {
            baseUrl,
            email,
            apiToken,
            isCloud,
            issueKey,
            timeSpentSeconds,
            started,
            comment,
          });
        } else {
          // Same issue, just update
          await invoke("update_worklog", {
            baseUrl,
            email,
            apiToken,
            isCloud,
            issueKey,
            worklogId: editWorklog.id,
            timeSpentSeconds,
            started,
            comment,
          });
        }
      } else {
        await invoke("add_worklog", {
          baseUrl,
          email,
          apiToken,
          isCloud,
          issueKey,
          timeSpentSeconds,
          started,
          comment,
        });
      }

      // Success: UI handles reset/closing via onWorklogSubmitted.
      // We pass all fields so Workspace can update the UI optimistically.
      onWorklogSubmitted({ issueKey, summary, hours, date, description: comment, started });

      description = "";
      startedDate = selectedDate;
      startedTime = "09:00";
      chipState = { chipHours: 1, customHours: null };
      customHoursText = "";
      submitState = "success";

      successResetTimer = setTimeout(() => {
        if (submitState === "success") submitState = "idle";
        successResetTimer = null;
      }, 2000);
    } catch (err) {
      const classified = classifyError(err);

      if (classified.type === "network") {
        try {
          await addPendingWorklog({
            issueKey,
            timeSpentSeconds,
            started,
            comment,
          });
          submitState = "queued";
          onWorklogQueued({ issueKey, summary, hours, date, description: comment, started });

          // Hold the queued state long enough for the user to read it; same
          // duration as success so the visual rhythm matches.
          queuedResetTimer = setTimeout(() => {
            if (submitState === "queued") submitState = "idle";
            queuedResetTimer = null;
          }, 2000);
        } catch (enqueueErr) {
          // Enqueue failed — surface as an error and do NOT show a queued
          // confirmation (R15.2 corner case).
          submitState = "error";
          submitError =
            enqueueErr instanceof Error
              ? `Could not queue worklog for sync: ${enqueueErr.message}`
              : "Could not queue worklog for sync.";
        }
      } else {
        submitState = "error";
        submitError = classified.message;
        // Selected issue, hours, and description are preserved per R15.3.
      }
    }
  }

  // --- IDs (R13.7) ---

  // Stable id prefix so a page can mount multiple QuickLogCards without
  // collisions (defensive — only one is mounted today).
  const uid = `qlc-${Math.random().toString(36).slice(2, 8)}`;
  const customHoursId = `${uid}-custom-hours`;
  const startedDateId = `${uid}-started-date`;
  const descriptionId = `${uid}-description`;
  const errorId = `${uid}-error`;

  // --- Selected date display ---

  const selectedDateLabel = $derived(formatSelectedDate(selectedDate));

  function formatSelectedDate(date: string): string {
    // `date` is YYYY-MM-DD; format with the user's locale to keep the badge
    // human-readable. Construct via `T00:00:00` to avoid UTC drift.
    try {
      const d = new Date(`${date}T00:00:00`);
      if (Number.isNaN(d.getTime())) return date;
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch {
      return date;
    }
  }
</script>

<section class="quick-log-card glass glass-overlay" aria-labelledby="{uid}-heading">
  <header class="card-header">
    <h2 id="{uid}-heading" class="card-title">Log Work</h2>
    <span class="date-badge" aria-label="Selected date {selectedDateLabel}">
      {selectedDateLabel}
    </span>
  </header>

  <!-- Project picker -->
  <div class="section">
    <label for="{uid}-project" class="field-label">Project</label>
    <div class="project-picker">
      <div class="project-input-wrap">
        <input
          id="{uid}-project"
          type="text"
          class="project-input"
          autocomplete="off"
          spellcheck="false"
          placeholder={selectedProject
            ? `${selectedProject.key} — ${selectedProject.name}`
            : "All projects (klik untuk memilih)"}
          value={projectQuery}
          oninput={onProjectInput}
          onfocus={() => void openProjectPicker()}
          onkeydown={onProjectKeydown}
          aria-haspopup="listbox"
          aria-expanded={projectOpen}
          aria-controls="{uid}-project-listbox"
          aria-activedescendant={projectOpen && filteredProjects[projectActiveIndex]
            ? `${uid}-project-opt-${projectActiveIndex}`
            : undefined}
          bind:this={projectInputEl}
        />
        {#if selectedProject}
          <button
            type="button"
            class="project-clear"
            aria-label="Hapus pilihan project (kembali ke semua project)"
            onclick={() => chooseProject(null)}
          >
            ×
          </button>
        {/if}
      </div>

      {#if projectOpen}
        <ul
          id="{uid}-project-listbox"
          class="project-listbox glass"
          role="listbox"
          aria-label="Daftar project"
          bind:this={projectListboxEl}
        >
          {#if projectsLoading && !projectsLoaded}
            <li class="project-status" aria-live="polite">Memuat project…</li>
          {:else if projectsError}
            <li class="project-status error" role="alert">{projectsError}</li>
          {:else if filteredProjects.length === 0}
            <li class="project-status">Tidak ada project yang cocok.</li>
          {:else}
            {#each filteredProjects as p, i (p.key)}
              <li
                id="{uid}-project-opt-{i}"
                role="option"
                aria-selected={projectActiveIndex === i}
                class="project-option"
                class:active={projectActiveIndex === i}
                class:current={selectedProject?.key === p.key}
                onmouseenter={() => (projectActiveIndex = i)}
                onclick={() => chooseProject(p)}
              >
                <span class="project-option-key">{p.key}</span>
                <span class="project-option-name">{p.name}</span>
              </li>
            {/each}
          {/if}
        </ul>
      {/if}
    </div>
    {#if projectsError && !projectOpen}
      <p class="project-error" role="alert">{projectsError}</p>
    {/if}
  </div>

  <!-- Recent issues (with optional inline error) -->
  <div class="section">
    {#if recentIssuesError}
      <p class="recent-error" role="alert">{recentIssuesError}</p>
    {/if}
    <RecentIssuesList
      issues={recentIssues}
      selectedKey={selectedIssue?.key ?? null}
      onSelect={handleRecentSelect}
    />
  </div>

  <!-- Universal search -->
  <div class="section">
    <UniversalSearch
      {baseUrl}
      {email}
      {apiToken}
      {isCloud}
      projectKey={selectedProject?.key}
      autoSearchOnEmpty={!!selectedProject}
      onSelect={handleSearchSelect}
    />
  </div>

  <!-- Selected issue summary -->
  {#if selectedIssue}
    <div class="selected-issue" aria-live="polite">
      <span class="selected-label">Selected:</span>
      <span class="selected-key">{selectedIssue.key}</span>
      <span class="selected-summary" title={selectedIssue.summary}>
        {selectedIssue.summary}
      </span>
      <button
        type="button"
        class="selected-cancel"
        aria-label="Batalkan pilihan issue"
        title="Batalkan pilihan"
        onclick={() => {
          selectedIssue = null;
          submitState = "idle";
          submitError = null;
        }}
      >
        ×
      </button>
    </div>
  {/if}

  <!-- Hours: chips + custom hours -->
  <div class="section hours-section">
    <TimePresetChips value={chipState.chipHours} onChange={handleChipChange} />

    <div class="custom-hours">
      <label for={customHoursId} class="custom-hours-label">
        Custom hours
      </label>
      <input
        id={customHoursId}
        type="number"
        min="0.25"
        max="24"
        step="0.25"
        inputmode="decimal"
        placeholder="e.g. 1.5"
        class="custom-hours-input"
        value={customHoursText}
        oninput={handleCustomHoursInput}
        aria-describedby="{uid}-hours-hint"
      />
      <span id="{uid}-hours-hint" class="hint">0.25–24 in 0.25 steps</span>
    </div>
  </div>

  <!-- Date started -->
  <div class="section">
    <label for={startedDateId} class="field-label">Date started</label>
    <div class="datetime-row">
      <input
        id={startedDateId}
        type="date"
        class="datetime-input datetime-date"
        bind:value={startedDate}
      />
      <input
        type="time"
        class="datetime-input datetime-time"
        aria-label="Waktu mulai"
        bind:value={startedTime}
      />
    </div>
  </div>

  <!-- Description -->
  <div class="section">
    <label for={descriptionId} class="field-label">
      Description (optional)
    </label>
    <DescriptionEditor
      id={descriptionId}
      bind:value={description}
      maxlength={500}
      placeholder="What did you work on?"
      ariaInvalid={!descriptionValid}
    />
    <div class="char-count" aria-live="polite">
      {description.length} / 500
    </div>
  </div>

  <!-- Status messages -->
  {#if submitState === "success"}
    <div class="status status-success" role="status" aria-live="polite">
      <svg
        class="status-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>Worklog submitted</span>
    </div>
  {:else if submitState === "queued"}
    <div class="status status-queued" role="status" aria-live="polite">
      <svg
        class="status-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span>Queued for sync</span>
    </div>
  {:else if submitState === "error" && submitError}
    <div
      id={errorId}
      class="status status-error"
      role="alert"
      aria-live="assertive"
    >
      <svg
        class="status-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{submitError}</span>
    </div>
  {/if}

  <!-- Submit / Actions -->
  <div class="actions-group">
    {#if editWorklog}
      <button
        type="button"
        class="cancel-btn"
        onclick={onCancelEdit}
      >
        Cancel
      </button>
    {/if}
    <button
      type="button"
      class="submit-btn"
      disabled={!canSubmitNow}
      aria-busy={submitState === "submitting"}
      aria-describedby={submitState === "error" ? errorId : undefined}
      onclick={handleSubmit}
    >
      {#if submitState === "submitting"}
        <span class="spinner" aria-hidden="true"></span>
        <span>{editWorklog ? "Updating…" : "Submitting…"}</span>
      {:else}
        <span>{editWorklog ? (localEdit ? "Simpan Draf" : "Update Worklog") : "Submit"}</span>
      {/if}
    </button>
  </div>
</section>

<style>
  .quick-log-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .card-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .date-badge {
    font-size: 0.75rem;
    font-weight: 500;
    color: #c7d2fe;
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.3);
    padding: 0.25rem 0.625rem;
    border-radius: 999px;
    letter-spacing: 0.01em;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* --- Project picker (searchable combobox) --- */

  .project-picker {
    position: relative;
  }

  .project-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .project-input {
    width: 100%;
    padding: 0.625rem 2.25rem 0.625rem 0.875rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font: inherit;
    font-size: 0.9375rem;
    transition:
      border-color 200ms ease-out,
      background 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .project-input::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .project-input:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .project-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgba(255, 255, 255, 0.08);
  }

  .project-clear {
    position: absolute;
    right: 0.375rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    border-radius: 999px;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .project-clear:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
  }

  .project-clear:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .project-listbox {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 0;
    right: 0;
    z-index: 20;
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    max-height: 18rem;
    overflow-y: auto;
    /* Override the .glass utility default to a near-opaque dark surface
     * so the search input below it stays legible through the dropdown. */
    background:
      linear-gradient(
        180deg,
        rgba(15, 23, 42, 0.96) 0%,
        rgba(15, 23, 42, 0.94) 100%
      );
    backdrop-filter: blur(28px) saturate(1.2);
    -webkit-backdrop-filter: blur(28px) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow:
      0 20px 40px -12px rgba(0, 0, 0, 0.65),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  }

  .project-status {
    padding: 0.625rem 0.75rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
  }

  .project-status.error {
    color: #fca5a5;
  }

  .project-option {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background 150ms ease-out;
  }

  .project-option:hover,
  .project-option.active {
    background: rgba(99, 102, 241, 0.16);
  }

  .project-option.current {
    background: rgba(99, 102, 241, 0.24);
  }

  .project-option-key {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #c7d2fe;
    flex-shrink: 0;
    letter-spacing: 0.01em;
  }

  .project-option-name {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .recent-error {
    margin: 0 0 0.5rem 0;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 0.8125rem;
  }

  .selected-issue {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(99, 102, 241, 0.10);
    border: 1px solid rgba(99, 102, 241, 0.25);
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.92);
    min-width: 0;
  }

  .selected-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(199, 210, 254, 0.85);
    flex-shrink: 0;
  }

  .selected-key {
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
    font-weight: 600;
    color: #c7d2fe;
    flex-shrink: 0;
  }

  .selected-summary {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: rgba(255, 255, 255, 0.85);
  }

  /* Cancel button — discard the current issue selection so the user can
   * pick another or step away from the form. Uses the same circular
   * pill chrome as the Project picker's clear button so the affordance
   * reads as "remove this scoped value". */
  .selected-cancel {
    flex-shrink: 0;
    width: 1.375rem;
    height: 1.375rem;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.9375rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .selected-cancel:hover {
    background: rgba(239, 68, 68, 0.22);
    color: #fecaca;
  }

  .selected-cancel:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .hours-section {
    gap: 0.75rem;
  }

  .custom-hours {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .custom-hours-label,
  .field-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
    letter-spacing: 0.02em;
  }

  .custom-hours-input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font-size: 0.875rem;
    font-family: inherit;
    transition:
      border-color 0.2s ease-out,
      box-shadow 0.15s ease-out,
      background 0.2s ease-out;
    outline: none;
  }

  .custom-hours-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .custom-hours-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgba(255, 255, 255, 0.08);
  }

  /* --- Date started (date + time) --- */
  .datetime-row {
    display: flex;
    gap: 0.5rem;
  }

  .datetime-input {
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font-size: 0.875rem;
    font-family: inherit;
    /* Render the native date/time picker chrome in dark mode. */
    color-scheme: dark;
    transition:
      border-color 0.2s ease-out,
      box-shadow 0.15s ease-out,
      background 0.2s ease-out;
    outline: none;
  }

  .datetime-date {
    flex: 1 1 60%;
    min-width: 0;
  }

  .datetime-time {
    flex: 1 1 40%;
    min-width: 0;
  }

  .datetime-input:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .datetime-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgba(255, 255, 255, 0.08);
  }

  .hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .char-count {
    align-self: flex-end;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: -0.25rem;
  }

  /* Status banners */
  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .status-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .status-success {
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.35);
    color: #86efac;
    animation: status-flash 1.8s ease-out;
  }

  .status-queued {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    color: #fcd34d;
  }

  .status-error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }

  @keyframes status-flash {
    0% {
      transform: scale(1);
    }
    20% {
      transform: scale(1.02);
    }
    40% {
      transform: scale(1);
    }
  }

  /* Actions group for Submit/Cancel */
  .actions-group {
    display: flex;
    gap: 0.75rem;
    width: 100%;
  }

  .cancel-btn {
    padding: 0.875rem 1.25rem;
    border-radius: 0.625rem;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg-strong);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease-out;
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  /* Submit button — primary indigo gradient matching Login */
  .submit-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.875rem;
    border-radius: 0.625rem;
    border: none;
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      opacity 0.2s ease-out,
      transform 0.1s ease-out,
      box-shadow 0.2s ease-out;
    box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
    outline: none;
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
  }

  .submit-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .submit-btn:focus-visible {
    box-shadow:
      var(--focus-ring),
      0 4px 15px rgba(99, 102, 241, 0.3);
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* Loading spinner inside the submit button */
  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .submit-btn,
    .custom-hours-input,
    .datetime-input {
      transition: none;
    }
    .status-success {
      animation: none;
    }
    .spinner {
      animation: none;
    }
  }
</style>
