<script lang="ts">
  /**
   * CalendarGrid
   *
   * Calendar grid yang dapat diatur tampilannya: per hari, minggu, atau bulan.
   * Memakai data worklog yang sama dengan HeatmapCalendar sehingga total jam
   * per tanggal tetap konsisten.
   *
   * Props:
   *   - worklogsByDate: agregasi jam per YYYY-MM-DD
   *   - selectedDate:   tanggal aktif (YYYY-MM-DD) untuk sinkronisasi dengan
   *                     QuickLogCard
   *   - isLoading:      true → render skeleton sesuai mode
   *   - onSelectDate:   dipanggil saat user mengklik sebuah cell
   *   - baseUrl:        URL Jira, dipakai untuk membentuk link `/browse/<KEY>`
   *
   * Tiga mode:
   *   - "day"   → satu kartu besar untuk tanggal terpilih + ringkasan entries
   *   - "week"  → 7 kolom (Sen–Min) dengan total jam per hari
   *   - "month" → grid kalender bulanan 6×7 dengan total jam per hari
   */

  import type { WorklogDay, WorklogEntry } from "../stores/worklogStore";
  import {
    getHoliday,
    type IndonesianHoliday,
  } from "../stores/indonesianHolidaysStore";
  import { untrack } from "svelte";
  import { t } from "../stores/i18n.svelte";

  type ViewMode = "day" | "week" | "month" | "list";

  interface Props {
    worklogsByDate: Record<string, WorklogDay>;
    selectedDate: string | null;
    isLoading?: boolean;
    onSelectDate: (date: string) => void;
    baseUrl?: string;
    /**
     * Target jam per hari yang dipakai sebagai baseline gradasi warna cell.
     * Default 8 jam (sehari kerja standar). Cell dengan jam mendekati nilai
     * ini akan tampil hijau; di bawahnya akan progresif merah → kuning;
     * di atasnya akan saturasi hijau sampai teal.
     */
    baseline?: number;
    /** Notify parent ketika user mengganti mode (Hari/Minggu/Bulan/Daftar). */
    onModeChange?: (mode: ViewMode) => void;
    /** Notify parent ketika cursor periode berubah (navigasi prev/next/today/select). */
    onCursorChange?: (date: string) => void;
    /**
     * Dipanggil saat user drop sebuah entry worklog ke cell tanggal lain.
     * Parent (Workspace) yang tahu credential + meng-handle PUT ke Jira;
     * komponen ini hanya capture intent-nya. Implementasi parent perlu
     * melakukan optimistic update pada `worklogsByDate` dan revert kalau
     * gagal. Callback tidak dipanggil saat source === target.
     */
    onWorklogMoved?: (move: {
      worklogId: string;
      issueKey: string;
      sourceDate: string;
      targetDate: string;
      timeSpentSeconds: number;
      /** Original `started` ISO (jika ada), untuk preserve time-of-day. */
      sourceStarted?: string;
    }) => void;
    /** Notify parent when user wants to edit a worklog. */
    onWorklogEdit?: (entry: WorklogEntry, date: string) => void;
    /** Notify parent when user wants to delete a worklog. */
    onWorklogDelete?: (worklogId: string, issueKey: string, date: string) => void;
    /** Notify parent that the user wants to add a worklog for a given date —
     *  opens the Log Work form without leaving the current view. An optional
     *  "HH:mm" prefills the start time (used when clicking an empty Day slot). */
    onAddWorklog?: (date: string, startedTime?: string) => void;
    /** Persist a Day-view reschedule/resize: new start time and/or duration
     *  for an existing worklog (same date). Parent does the optimistic update
     *  + PUT to Jira, mirroring `onWorklogMoved`. */
    onWorklogReschedule?: (change: {
      worklogId: string;
      issueKey: string;
      sourceDate: string;
      date: string;
      started: string;
      timeSpentSeconds: number;
      hours: number;
    }) => void;
  }

  let {
    worklogsByDate,
    selectedDate,
    isLoading = false,
    onSelectDate,
    baseUrl = "",
    baseline = 8,
    onModeChange,
    onCursorChange,
    onWorklogMoved,
    onWorklogEdit,
    onWorklogDelete,
    onAddWorklog,
    onWorklogReschedule,
  }: Props = $props();

  // ---------------------------------------------------------------------
  // Drag-and-drop state — moving a worklog entry between cells via native
  // HTML5 DnD. Kept module-local (not Svelte $state) because the dragged
  // payload is read once on drop and never rendered; only `dragOverDate`
  // affects visuals.
  // ---------------------------------------------------------------------
  interface DraggedWorklog {
    id: string;
    sourceDate: string;
    issueKey: string;
    timeSpentSeconds: number;
    started?: string;
  }
  let draggedWorklog: DraggedWorklog | null = null;
  let dragOverDate = $state<string | null>(null);

  // Cell merender semua entry untuk hari itu — tidak ada cap. Cell akan
  // tumbuh sesuai jumlah chip; baris grid otomatis menyamakan tinggi. Hover
  // popover tetap ada sebagai cara untuk membuka link issue dengan nyaman.

  /** Truncate "ABC-1234" → "ABC-1234" but for longer keys provide a sensible
   *  short form. Most Jira keys are already short; this is just a safety net. */
  function shortKey(key: string): string {
    return key.length > 12 ? `${key.slice(0, 10)}…` : key;
  }

  function handleEntryDragStart(
    event: DragEvent,
    entry: WorklogEntry,
    date: string,
  ): void {
    if (!entry.id || !onWorklogMoved) {
      event.preventDefault();
      return;
    }
    draggedWorklog = {
      id: entry.id,
      sourceDate: date,
      issueKey: entry.issueKey,
      timeSpentSeconds:
        entry.timeSpentSeconds ?? Math.round(entry.hours * 3600),
      started: entry.started,
    };
    // Some browsers (Firefox) require dataTransfer to be set for the drag
    // to start. The string value isn't used downstream — we read from the
    // module-level `draggedWorklog` for the rich payload.
    event.dataTransfer?.setData("text/plain", entry.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleEntryDragEnd(): void {
    draggedWorklog = null;
    dragOverDate = null;
  }

  function handleCellDragOver(event: DragEvent, targetDate: string): void {
    if (!draggedWorklog || draggedWorklog.sourceDate === targetDate) return;
    event.preventDefault(); // signal "drop allowed"
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (dragOverDate !== targetDate) {
      dragOverDate = targetDate;
    }
  }

  function handleCellDragLeave(event: DragEvent, targetDate: string): void {
    // Only clear the highlight when the pointer actually leaves the cell —
    // moving over a child element fires dragleave but `relatedTarget`
    // belongs to the same cell. We check `currentTarget` containment.
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;
    if (related && current && current.contains(related)) return;
    if (dragOverDate === targetDate) dragOverDate = null;
  }

  function handleCellDrop(event: DragEvent, targetDate: string): void {
    event.preventDefault();
    const payload = draggedWorklog;
    draggedWorklog = null;
    dragOverDate = null;
    if (!payload || payload.sourceDate === targetDate) return;
    onWorklogMoved?.({
      worklogId: payload.id,
      issueKey: payload.issueKey,
      sourceDate: payload.sourceDate,
      targetDate,
      timeSpentSeconds: payload.timeSpentSeconds,
      sourceStarted: payload.started,
    });
  }

  /** Keyboard activate for cell — replaces the `<button>` semantics now
   *  that the cell is a `<div role="button">` (so draggable chips can be
   *  nested without violating HTML's "no buttons in buttons" rule). */
  function handleCellKeydown(event: KeyboardEvent, date: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDay(date);
    }
  }

  // ---------------------------------------------------------------------
  // State internal: mode & cursor (anchor date untuk periode yang ditampilkan)
  // ---------------------------------------------------------------------
  let mode = $state<ViewMode>("month");

  // Cursor sebagai YYYY-MM-DD. Awalnya = selectedDate atau hari ini.
  // Cursor dipakai sebagai "tanggal jangkar" periode yang sedang ditampilkan
  // (hari yang dipilih untuk day, minggu yang memuat tanggal untuk week,
  //  bulan yang memuat tanggal untuk month).
  // Use `untrack` so reading `selectedDate` here doesn't tie cursor's
  // initial-value computation to the prop's reactive graph (Svelte
  // otherwise warns that we're capturing only the initial value).
  const todayStr = toYMD(new Date());
  let cursor = $state<string>(untrack(() => selectedDate ?? todayStr));

  // Saat parent mengubah selectedDate, tarik cursor ke tanggal itu agar
  // periode yang ditampilkan mengikuti pilihan user. Notify parent juga
  // supaya WeeklySummary bisa men-track cursor.
  $effect(() => {
    if (selectedDate) {
      cursor = selectedDate;
      onCursorChange?.(selectedDate);
    }
  });

  const VIEW_OPTIONS: { value: ViewMode; label: string; icon: string }[] = [
    // `icon` is an inline SVG `d` attribute drawn at 16×16 inside each chip.
    // Keeping the path data here avoids pulling in an icon library just for
    // four glyphs.
    { value: "day", label: "Hari",   icon: "M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" },
    { value: "week",  label: "Minggu", icon: "M3 6h18M3 12h18M3 18h18M8 4v16M16 4v16" },
    { value: "month", label: "Bulan",  icon: "M3 4h18v16H3zM3 10h18M8 2v4M16 2v4" },
    { value: "list",  label: "Daftar", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  ];

  /** Pilihan pengelompokan untuk mode Daftar. */
  const LIST_GROUP_OPTIONS: ReadonlyArray<{
    value: "date" | "issue";
    label: string;
  }> = [
    { value: "date", label: "Per tanggal" },
    { value: "issue", label: "Per issue" },
  ];

  // ---------------------------------------------------------------------
  // Date helpers (local-time agar tidak ada pergeseran timezone)
  // ---------------------------------------------------------------------
  function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseYMD(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }

  function addDays(d: Date, days: number): Date {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + days);
    return r;
  }

  function addMonths(d: Date, months: number): Date {
    return new Date(d.getFullYear(), d.getMonth() + months, 1);
  }

  /** Minggu (Sunday) dari minggu yang memuat `d`.
   *  Kalender memakai patokan Minggu sebagai awal minggu, sehingga
   *  kolom paling kiri di grid Bulan/Minggu adalah hari Minggu. */
  function startOfSundayWeek(d: Date): Date {
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    return addDays(d, -dow);
  }

  // ---------------------------------------------------------------------
  // Derived: tanggal-tanggal yang ditampilkan untuk tiap mode
  // ---------------------------------------------------------------------
  let cursorDate = $derived(parseYMD(cursor));

  // Day mode: satu tanggal saja.
  let dayCell = $derived(buildDayCell(cursor));

  // Week mode: 7 hari (Sen–Min) yang memuat cursor.
  let weekCells = $derived(buildWeekCells(cursorDate));

  // Month mode: grid 6x7 (42 cell) Sen–Min yang memuat seluruh bulan cursor.
  let monthCells = $derived(buildMonthCells(cursorDate));

  let monthLabel = $derived(
    cursorDate.toLocaleDateString("en-GB",{
      month: "long",
      year: "numeric",
    }),
  );

  let weekLabel = $derived(formatWeekLabel(cursorDate));

  let dayLabel = $derived(
    cursorDate.toLocaleDateString("en-GB",{ dateStyle: "full" }),
  );

  interface CalCell {
    date: string;
    hours: number;
    /**
     * Background color (HSL string) yang merepresentasikan rasio
     * `hours / baseline`. Lihat `colorForHours` untuk skala warnanya.
     */
    bg: string;
    inCurrentMonth: boolean;
    isToday: boolean;
    /** Nama hari libur, atau null kalau bukan tanggal merah. */
    holidayName: string | null;
    /** Jenis libur: nasional (SKB) atau cuti bersama perusahaan. */
    holidayKind: IndonesianHoliday["kind"] | null;
  }

  /**
   * Pure: hitung warna cell dari jumlah jam terhadap baseline.
   *
   * Skala (rasio = hours / baseline):
   *   r ≤ 0    → background netral gelap (tidak ada worklog)
   *   r < 1    → merah → oranye → kuning, lightness/saturation naik
   *              progresif sampai mencapai baseline.
   *   r = 1    → hijau penuh (target tercapai)
   *   r > 1    → hijau bergeser ke teal, makin cerah sampai r = 1.5+
   *              (overtime). Setelah itu jenuh.
   *
   * HSL hue: 0 (merah) → 60 (kuning) → 140 (hijau) → 165 (teal).
   * Saturasi & lightness disesuaikan agar tetap kontras di dark mode.
   */
  function colorForHours(hours: number, base: number): string {
    if (!Number.isFinite(hours) || hours <= 0 || base <= 0) {
      return "rgba(255, 255, 255, 0.05)";
    }
    const r = hours / base;
    if (r <= 1) {
      // Below baseline: hue ramps from red (0°) at r=0 to yellow (60°)
      // at r=0.7, then to green (140°) at r=1.
      let hue: number;
      if (r < 0.7) {
        hue = (r / 0.7) * 60; // 0..60
      } else {
        hue = 60 + ((r - 0.7) / 0.3) * 80; // 60..140
      }
      // Saturation rises with effort; lightness peaks near baseline.
      const sat = 60 + r * 25; // 60..85
      const light = 30 + r * 18; // 30..48
      return `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`;
    }
    // Over baseline: hue stays in green/teal range; lightness slowly fades
    // back so the cell doesn't get blindingly bright on heavy days.
    const over = Math.min(r - 1, 1); // 0..1 (cap at 2× baseline)
    const hue = 140 + over * 25; // 140..165
    const sat = 80 - over * 10; // 80..70
    const light = 48 + over * 6; // 48..54
    return `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`;
  }

  function buildDayCell(date: string): CalCell {
    const hours = worklogsByDate[date]?.totalHours ?? 0;
    const h = getHoliday(date);
    return {
      date,
      hours,
      bg: colorForHours(hours, baseline),
      inCurrentMonth: true,
      isToday: date === todayStr,
      holidayName: h?.name ?? null,
      holidayKind: h?.kind ?? null,
    };
  }

  function buildWeekCells(d: Date): CalCell[] {
    const sunday = startOfSundayWeek(d);
    const cells: CalCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cur = addDays(sunday, i);
      const date = toYMD(cur);
      const hours = worklogsByDate[date]?.totalHours ?? 0;
      const h = getHoliday(date);
      cells.push({
        date,
        hours,
        bg: colorForHours(hours, baseline),
        inCurrentMonth: cur.getMonth() === d.getMonth(),
        isToday: date === todayStr,
        holidayName: h?.name ?? null,
        holidayKind: h?.kind ?? null,
      });
    }
    return cells;
  }

  function buildMonthCells(d: Date): CalCell[] {
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const start = startOfSundayWeek(firstOfMonth);
    const cells: CalCell[] = [];
    for (let i = 0; i < 42; i++) {
      const cur = addDays(start, i);
      const date = toYMD(cur);
      const hours = worklogsByDate[date]?.totalHours ?? 0;
      const h = getHoliday(date);
      cells.push({
        date,
        hours,
        bg: colorForHours(hours, baseline),
        inCurrentMonth: cur.getMonth() === d.getMonth(),
        isToday: date === todayStr,
        holidayName: h?.name ?? null,
        holidayKind: h?.kind ?? null,
      });
    }
    return cells;
  }

  function formatWeekLabel(d: Date): string {
    const sunday = startOfSundayWeek(d);
    const saturday = addDays(sunday, 6);
    const sameMonth = sunday.getMonth() === saturday.getMonth();
    const sameYear = sunday.getFullYear() === saturday.getFullYear();
    const fmtDay = (x: Date) => x.getDate();
    const fmtMonth = (x: Date) =>
      x.toLocaleDateString("en-GB",{ month: "short" });
    const fmtYear = (x: Date) => x.getFullYear();

    if (sameMonth && sameYear) {
      return `${fmtDay(sunday)}–${fmtDay(saturday)} ${fmtMonth(sunday)} ${fmtYear(sunday)}`;
    }
    if (sameYear) {
      return `${fmtDay(sunday)} ${fmtMonth(sunday)} – ${fmtDay(saturday)} ${fmtMonth(saturday)} ${fmtYear(sunday)}`;
    }
    return `${fmtDay(sunday)} ${fmtMonth(sunday)} ${fmtYear(sunday)} – ${fmtDay(saturday)} ${fmtMonth(saturday)} ${fmtYear(saturday)}`;
  }

  // List mode: entri di dalam bulan `cursor`, dikelompokkan per tanggal
  // (terbaru dulu). Hanya tanggal dengan jam > 0 yang masuk, supaya tidak
  // ada baris kosong untuk hari yang tidak dicatat.
  //
  // Scoping ke bulan itu penting: sebelumnya view ini menyapu seluruh
  // `worklogsByDate` — yaitu seluruh rentang fetch (dua bulan) — sehingga
  // isinya tidak cocok dengan judul periode di header, tombol ‹ › tidak
  // mengubah apa pun, dan PERIOD TOTAL bertabrakan dengan angka bulanan di
  // WeeklySummary.
  let listGroups = $derived.by(() => {
    const prefix = `${cursorDate.getFullYear()}-${String(
      cursorDate.getMonth() + 1,
    ).padStart(2, "0")}`;
    const groups: Array<{
      date: string;
      hours: number;
      entries: WorklogEntry[];
    }> = [];
    for (const [date, day] of Object.entries(worklogsByDate)) {
      if (!date.startsWith(prefix)) continue;
      if (!day || !(day.totalHours > 0)) continue;
      groups.push({ date, hours: day.totalHours, entries: day.entries });
    }
    groups.sort((a, b) => (a.date < b.date ? 1 : -1));
    return groups;
  });

  /**
   * Cara mengelompokkan daftar. "date" kronologis seperti kalender; "issue"
   * mengagregasi per issue — pertanyaan "bulan ini waktu saya habis di
   * mana", yang justru tidak bisa dijawab tampilan grid mana pun.
   */
  let listGroupBy = $state<"date" | "issue">("date");

  interface IssueGroup {
    issueKey: string;
    summary: string;
    hours: number;
    /** Entri penyusun, dengan tanggalnya (WorklogEntry tak selalu punya `started`). */
    items: Array<{ date: string; entry: WorklogEntry }>;
  }

  let issueGroups = $derived.by<IssueGroup[]>(() => {
    const map = new Map<string, IssueGroup>();
    for (const g of listGroups) {
      for (const entry of g.entries) {
        let grp = map.get(entry.issueKey);
        if (!grp) {
          grp = { issueKey: entry.issueKey, summary: "", hours: 0, items: [] };
          map.set(entry.issueKey, grp);
        }
        grp.hours += entry.hours;
        if (!grp.summary && entry.summary) grp.summary = entry.summary;
        grp.items.push({ date: g.date, entry });
      }
    }
    // Terbanyak dulu — itulah jawaban "habis di mana".
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  });

  /** Porsi sebuah issue terhadap total bulan, dibulatkan ke persen. */
  function issueShare(hours: number): number {
    const total = listGroups.reduce((s, g) => s + g.hours, 0);
    return total > 0 ? Math.round((hours / total) * 100) : 0;
  }

  /** Tanggal ringkas untuk baris di dalam kelompok issue, mis. "4 Sep". */
  function shortDate(ymd: string): string {
    return parseYMD(ymd).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  }

  // Total jam pada periode yang ditampilkan (untuk header).
  let periodTotal = $derived.by(() => {
    if (mode === "day") return dayCell.hours;
    if (mode === "week")
      return weekCells.reduce((s, c) => s + c.hours, 0);
    if (mode === "list")
      return listGroups.reduce((s, g) => s + g.hours, 0);
    return monthCells
      .filter((c) => c.inCurrentMonth)
      .reduce((s, c) => s + c.hours, 0);
  });

  // ---------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------
  function gotoPrev(): void {
    const d = parseYMD(cursor);
    let next: string;
    if (mode === "day") next = toYMD(addDays(d, -1));
    else if (mode === "week") next = toYMD(addDays(d, -7));
    else next = toYMD(addMonths(d, -1));
    cursor = next;
    onCursorChange?.(next);
  }

  function gotoNext(): void {
    const d = parseYMD(cursor);
    let next: string;
    if (mode === "day") next = toYMD(addDays(d, 1));
    else if (mode === "week") next = toYMD(addDays(d, 7));
    else next = toYMD(addMonths(d, 1));
    cursor = next;
    onCursorChange?.(next);
  }

  function gotoToday(): void {
    cursor = todayStr;
    onCursorChange?.(todayStr);
    onSelectDate(todayStr);
  }

  function setMode(next: ViewMode): void {
    mode = next;
    onModeChange?.(next);
  }

  function handleSelect(date: string): void {
    cursor = date;
    onCursorChange?.(date);
    onSelectDate(date);
  }

  /** Clicking (or pressing Enter on) a day cell drills into that day's Day
   *  view. Use this for the grid cells; `handleSelect` alone only moves the
   *  selection/cursor without changing the view. */
  function openDay(date: string): void {
    handleSelect(date);
    if (mode !== "day") setMode("day");
  }

  // ---------------------------------------------------------------------
  // Jira issue link helpers
  // ---------------------------------------------------------------------

  /** Build `https://<base>/browse/<KEY>` defensively against missing or
   *  trailing-slash-laden base URLs. Returns "" when we can't form a real
   *  link, so callers can skip rendering the anchor. */
  function issueUrl(issueKey: string): string {
    if (!issueKey) return "";
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/browse/${encodeURIComponent(issueKey)}`;
  }

  /** Open the issue page in the user's default browser. We rely on the
   *  Tauri `shell:default` capability — the runtime restricts opens to
   *  http(s)/tel/mailto, so this is safe to call with arbitrary base URLs.
   *  Falls back silently if the runtime is unavailable. */
  async function openIssue(event: MouseEvent, issueKey: string): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const url = issueUrl(issueKey);
    if (!url) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      // Browser preview / tests: best-effort fallback to window.open so
      // the link still works outside the desktop runtime.
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* swallow */
      }
    }
  }

  // ---------------------------------------------------------------------
  // Hover popover (week & month) — shows the day's worklog entries with
  // clickable issue links. The popover follows the pointer so it appears
  // close to where the user is looking, rather than being anchored to the
  // entire cell rect. We also support keyboard focus by anchoring to the
  // focused cell's rect when there is no recent pointer position.
  // ---------------------------------------------------------------------

  interface HoverState {
    date: string;
    entryIndex?: number;
    /** Viewport rect of the hovered cell. The popover anchors beside this rect
     *  so it never covers the cell the user is trying to click. */
    rect: { top: number; left: number; bottom: number; right: number } | null;
  }

  let hover = $state<HoverState | null>(null);
  let hoverTimer = $state<number | null>(null);

  function clearHoverTimer(): void {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function showHoverByPointer(event: MouseEvent, date: string, entryIndex?: number): void {
    if (mode === "day") return;
    clearHoverTimer();
    // Anchor to the whole cell — works whether the pointer is over the cell
    // background or one of its entries — so the popover sits beside the cell.
    const cell = (event.currentTarget as HTMLElement | null)?.closest(".cell");
    const r = cell?.getBoundingClientRect();
    hover = {
      date,
      entryIndex,
      rect: r
        ? { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
        : null,
    };
  }

  function moveHoverByPointer(event: MouseEvent, date: string, entryIndex?: number): void {
    if (mode === "day") return;
    // As long as the pointer stays within the same day cell, keep whatever
    // popover is already showing. Without this, moving off an entry onto the
    // cell's background (e.g. heading toward the popover) would flip the
    // entry's popover back to the whole-cell one. Switching to a *different*
    // entry still happens via that entry's own `onmouseenter`.
    if (hover && hover.date === date) {
      clearHoverTimer();
      return;
    }
    // Pointer is over a different cell without a fresh mouseenter (rare) —
    // show it now.
    showHoverByPointer(event, date, entryIndex);
  }

  function showHoverByFocus(event: FocusEvent, date: string): void {
    if (mode === "day") return;
    clearHoverTimer();
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const r = target.getBoundingClientRect();
    hover = {
      date,
      rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
    };
  }

  function scheduleHide(): void {
    clearHoverTimer();
    // Grace period so the user can move the pointer across the gap from the
    // cell into the popover without it disappearing mid-flight. Generous
    // enough that even a slow, deliberate crossing keeps the popover alive.
    hoverTimer = window.setTimeout(() => {
      hover = null;
      hoverTimer = null;
      confirmDeleteId = null; // drop any pending popover delete-confirm
    }, 320);
  }

  function cancelHide(): void {
    clearHoverTimer();
  }

  let hoverEntries = $derived<WorklogEntry[]>(
    hover
      ? (hover.entryIndex !== undefined
          ? [worklogsByDate[hover.date]?.entries[hover.entryIndex]].filter(Boolean) as WorklogEntry[]
          : worklogsByDate[hover.date]?.entries ?? [])
      : [],
  );

  let hoverHours = $derived<number>(
    hover
      ? (hover.entryIndex !== undefined
          ? (worklogsByDate[hover.date]?.entries[hover.entryIndex]?.hours ?? 0)
          : (worklogsByDate[hover.date]?.totalHours ?? 0))
      : 0,
  );

  let hoverHoliday = $derived<IndonesianHoliday | null>(
    hover ? getHoliday(hover.date) : null,
  );

  let hoverHolidayName = $derived<string | null>(hoverHoliday?.name ?? null);
  let hoverHolidayKind = $derived<IndonesianHoliday["kind"] | null>(
    hoverHoliday?.kind ?? null,
  );

  // Anchor coords next to the cursor (or the focused cell when there's no
  // pointer). The popover is positioned by its top-left corner via fixed
  // coordinates; we pick a side that keeps the box on-screen.
  // Approximate dimensions used for edge-flipping.
  const HOVER_WIDTH = 320;
  const HOVER_MAX_HEIGHT = 640;
  // Gap between the cell and the popover that sits beside it.
  const HOVER_GAP = 8;

  // Actual rendered height of the popover, measured after it mounts. The
  // edge-flip math below uses this so a popover shorter than the 400px cap
  // hugs the cursor/cell instead of reserving the full max height and
  // floating far away (the gap that appeared when hovering bottom rows).
  let hoverEl = $state<HTMLDivElement | null>(null);
  let hoverHeight = $state(0);

  $effect(() => {
    // Re-measure whenever the hovered day/entry (and thus content) changes.
    void hoverEntries;
    void hoverHolidayName;
    hoverHeight = hoverEl?.offsetHeight ?? 0;
  });

  let hoverPos = $derived.by(() => {
    if (!hover || !hover.rect) return null;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;

    // Real height when measured; fall back to the cap for the first frame
    // before measurement so the box never spills off-screen initially.
    const h = hoverHeight || HOVER_MAX_HEIGHT;
    const { top, left, right } = hover.rect;

    // Horizontal: sit to the RIGHT of the cell with a small gap; flip to the
    // left if it would overflow. Anchoring beside the cell (not under the
    // cursor) keeps the hovered cell uncovered, so it stays clickable.
    let x = right + HOVER_GAP;
    if (x + HOVER_WIDTH + 4 > vw) {
      x = left - HOVER_WIDTH - HOVER_GAP;
    }
    x = Math.max(4, Math.min(x, vw - HOVER_WIDTH - 4));

    // Vertical: align near the cell's top, clamped so the whole box stays on
    // screen.
    const y = Math.max(4, Math.min(top, vh - h - 4));

    return { left: x, top: y };
  });

  // ---------------------------------------------------------------------
  // Locale formatting
  // ---------------------------------------------------------------------
  function formatLocaleDate(ymd: string): string {
    return parseYMD(ymd).toLocaleDateString("en-GB",{ dateStyle: "full" });
  }

  function dayNumber(ymd: string): number {
    return parseYMD(ymd).getDate();
  }

  // --- New Day View Helpers ---
  let timelineViewportHeight = $state(0);
  let HOUR_HEIGHT = $derived(timelineViewportHeight > 0 ? timelineViewportHeight / 24 : 64);
  const MIN_BLOCK_PX = $derived(Math.max(16, HOUR_HEIGHT * 0.4)); // Scale minimum block size with hour height

  // --- Lunch break band (Day & Week timelines) -----------------------------
  // 12:00–13:00 every day, extended to 13:30 on Fridays (getDay() === 5).
  const BREAK_START_MIN = 12 * 60;
  const BREAK_END_MIN = 13 * 60;
  const BREAK_END_MIN_FRIDAY = 13 * 60 + 30;

  /** Absolute top/height for the break band on a given day's timeline. */
  function breakBandStyle(date: string): string {
    const endMin =
      parseYMD(date).getDay() === 5 ? BREAK_END_MIN_FRIDAY : BREAK_END_MIN;
    const top = (BREAK_START_MIN / 60) * HOUR_HEIGHT;
    const height = ((endMin - BREAK_START_MIN) / 60) * HOUR_HEIGHT;
    return `top: ${top}px; height: ${height}px;`;
  }

  /** Saturday (6) / Sunday (0). */
  function isWeekend(date: string): boolean {
    const d = parseYMD(date).getDay();
    return d === 0 || d === 6;
  }

  /** No lunch break on weekends. */
  function hasBreak(date: string): boolean {
    return !isWeekend(date);
  }

  /**
   * Parse "HH:mm" from ISO started string.
   */
  function getStartTime(started?: string): { h: number; m: number } {
    if (!started) return { h: 9, m: 0 };
    try {
      const date = new Date(started);
      if (isNaN(date.getTime())) return { h: 9, m: 0 };
      return { h: date.getHours(), m: date.getMinutes() };
    } catch {
      return { h: 9, m: 0 };
    }
  }

  // --- Day view: drag-to-move (start time) & drag-to-resize (duration) ------
  const SNAP_MIN = 15; // snap interactions to the quarter hour
  const MIN_DURATION_MIN = 15;

  interface DayDragState {
    type: "move" | "resize";
    entryId: string;
    issueKey: string;
    sourceDate: string; // the entry's original day
    targetDate: string; // day under the pointer (week cross-day move); === sourceDate in Day view
    pointerStartY: number;
    origStartMin: number;
    origDurationMin: number;
    startMin: number; // live values driving the preview
    durationMin: number;
  }
  let dayDrag = $state<DayDragState | null>(null);

  // The week timeline's grid element — used to map a pointer's X to a day
  // column so a block can be dragged across days.
  let weekGridEl = $state<HTMLElement | null>(null);

  // After a block drag/resize the browser may synthesize a `click` on the grid
  // container; this flag swallows that one click so it doesn't open the add
  // form. Not reactive — only read inside event handlers.
  let suppressGridClick = false;

  // Inline delete confirmation for day-view blocks (the entry id awaiting a
  // confirm click). We avoid window.confirm(), which is unreliable in the
  // Tauri webview, in favour of an explicit in-block "Hapus / ✗" affordance.
  let confirmDeleteId = $state<string | null>(null);

  /** Day-view blocks are interactive only when the parent can persist edits. */
  let dayEditable = $derived(!!onWorklogReschedule);

  const snapMin = (min: number): number => Math.round(min / SNAP_MIN) * SNAP_MIN;
  const clampNum = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(v, hi));

  function entryStartMin(entry: WorklogEntry): number {
    const { h, m } = getStartTime(entry.started);
    return h * 60 + m;
  }
  function entryDurationMin(entry: WorklogEntry): number {
    return Math.max(MIN_DURATION_MIN, Math.round(entry.hours * 60));
  }

  /** Local tz offset ("+0700") — the timeline shows local hours, so a dragged
   *  wall-clock time is stored with the local offset to round-trip cleanly. */
  function gridLocalOffset(): string {
    const minutesEast = -new Date().getTimezoneOffset();
    const sign = minutesEast >= 0 ? "+" : "-";
    const abs = Math.abs(minutesEast);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}${mm}`;
  }

  function rescheduleStarted(date: string, minutes: number): string {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${date}T${hh}:${mm}:00.000${gridLocalOffset()}`;
  }

  /** Live geometry for a block — uses the in-flight drag values for the block
   *  being dragged so the move/resize previews as it happens. */
  function blockStyleFor(
    entry: WorklogEntry,
    layout?: BlockLayout,
    gutter = 12,
  ): string {
    const dragging = dayDrag && entry.id === dayDrag.entryId;
    const startMin = dragging ? dayDrag!.startMin : entryStartMin(entry);
    const durationMin = dragging ? dayDrag!.durationMin : entryDurationMin(entry);
    const top = (startMin / 60) * HOUR_HEIGHT;
    const height = Math.max(MIN_BLOCK_PX, (durationMin / 60) * HOUR_HEIGHT);
    // Horizontal placement comes from the overlap layout so concurrent
    // worklogs sit side-by-side instead of stacking. `gutter` is the side
    // inset (smaller for the narrow week columns). Falls back to full width.
    let horizontal = `left: ${gutter}px; right: ${gutter}px;`;
    if (layout) {
      const leftFrac = layout.leftPct / 100;
      const widthFrac = layout.widthPct / 100;
      const gap = widthFrac < 1 ? (gutter >= 8 ? 6 : 2) : 0; // between columns
      horizontal = `left: calc(${gutter}px + ${leftFrac} * (100% - ${gutter * 2}px)); width: calc(${widthFrac} * (100% - ${gutter * 2}px) - ${gap}px);`;
    }
    return `top: ${top}px; height: ${height}px; ${horizontal}`;
  }

  function liveStartLabel(entry: WorklogEntry): string {
    const min =
      dayDrag && entry.id === dayDrag.entryId ? dayDrag.startMin : entryStartMin(entry);
    const hh = String(Math.floor(min / 60)).padStart(2, "0");
    const mm = String(min % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  function liveHours(entry: WorklogEntry): number {
    const min =
      dayDrag && entry.id === dayDrag.entryId
        ? dayDrag.durationMin
        : entryDurationMin(entry);
    return min / 60;
  }

  /** End-of-worklog clock label (start + duration), tracking any live drag. */
  function liveEndLabel(entry: WorklogEntry): string {
    const dragging = dayDrag && entry.id === dayDrag.entryId;
    const startMin = dragging ? dayDrag!.startMin : entryStartMin(entry);
    const durationMin = dragging ? dayDrag!.durationMin : entryDurationMin(entry);
    const end = startMin + durationMin;
    const hh = String(Math.floor(end / 60)).padStart(2, "0");
    const mm = String(end % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function onBlockPointerDown(
    event: PointerEvent,
    entry: WorklogEntry,
    type: "move" | "resize",
    date: string,
  ): void {
    if (!dayEditable || !entry.id || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    confirmDeleteId = null; // starting a drag cancels any pending delete confirm
    hover = null; // hide any detail popover while dragging
    hoverSlot = null; // and the add-slot indicator
    const start = entryStartMin(entry);
    const duration = entryDurationMin(entry);
    dayDrag = {
      type,
      entryId: entry.id,
      issueKey: entry.issueKey,
      sourceDate: date,
      targetDate: date,
      pointerStartY: event.clientY,
      origStartMin: start,
      origDurationMin: duration,
      startMin: start,
      durationMin: duration,
    };
    window.addEventListener("pointermove", onDayPointerMove);
    window.addEventListener("pointerup", onDayPointerUp);
  }

  /** Map a viewport X coordinate to the date of the week column under it. */
  function dateAtX(clientX: number): string | null {
    if (!weekGridEl || weekCells.length === 0) return null;
    const rect = weekGridEl.getBoundingClientRect();
    const colWidth = rect.width / weekCells.length;
    let idx = Math.floor((clientX - rect.left) / colWidth);
    idx = Math.max(0, Math.min(idx, weekCells.length - 1));
    return weekCells[idx]?.date ?? null;
  }

  function onDayPointerMove(event: PointerEvent): void {
    if (!dayDrag) return;
    const deltaMin = ((event.clientY - dayDrag.pointerStartY) / HOUR_HEIGHT) * 60;
    if (dayDrag.type === "move") {
      const startMin = clampNum(
        snapMin(dayDrag.origStartMin + deltaMin),
        0,
        24 * 60 - dayDrag.durationMin,
      );
      // In the week timeline, horizontal movement re-targets the day column.
      const targetDate =
        mode === "week" ? dateAtX(event.clientX) ?? dayDrag.targetDate : dayDrag.targetDate;
      dayDrag = { ...dayDrag, startMin, targetDate };
    } else {
      const durationMin = clampNum(
        snapMin(dayDrag.origDurationMin + deltaMin),
        MIN_DURATION_MIN,
        24 * 60 - dayDrag.startMin,
      );
      dayDrag = { ...dayDrag, durationMin };
    }
  }

  function onDayPointerUp(): void {
    window.removeEventListener("pointermove", onDayPointerMove);
    window.removeEventListener("pointerup", onDayPointerUp);
    // Swallow the click the browser may synthesize right after this drag.
    suppressGridClick = true;
    setTimeout(() => {
      suppressGridClick = false;
    }, 0);
    const drag = dayDrag;
    dayDrag = null;
    if (!drag) return;
    // Plain click / no real change — don't hit the network.
    if (
      drag.startMin === drag.origStartMin &&
      drag.durationMin === drag.origDurationMin &&
      drag.targetDate === drag.sourceDate
    ) {
      return;
    }
    onWorklogReschedule?.({
      worklogId: drag.entryId,
      issueKey: drag.issueKey,
      sourceDate: drag.sourceDate,
      date: drag.targetDate,
      started: rescheduleStarted(drag.targetDate, drag.startMin),
      timeSpentSeconds: drag.durationMin * 60,
      hours: drag.durationMin / 60,
    });
  }

  // Defensive cleanup if the component unmounts mid-drag.
  $effect(() => () => {
    window.removeEventListener("pointermove", onDayPointerMove);
    window.removeEventListener("pointerup", onDayPointerUp);
  });

  // --- Day view: side-by-side layout for overlapping worklogs --------------
  interface BlockLayout {
    leftPct: number;
    widthPct: number;
  }

  /**
   * Lay out a day's entries into side-by-side columns so worklogs whose times
   * overlap don't stack on top of each other (Google-Calendar style). Returns
   * one {leftPct,widthPct} per entry, aligned to the input array order.
   *
   * Algorithm: sweep entries in start-time order, packing each into the first
   * column whose last event has already ended; a run of mutually overlapping
   * events forms a "cluster" that shares the width equally, and each event can
   * widen into adjacent free columns to its right.
   */
  function computeDayLayout(entries: WorklogEntry[]): BlockLayout[] {
    const n = entries.length;
    const result: BlockLayout[] = Array.from({ length: n }, () => ({
      leftPct: 0,
      widthPct: 100,
    }));
    if (n === 0) return result;

    const items = entries.map((e, i) => {
      const start = entryStartMin(e);
      return { i, start, end: start + entryDurationMin(e) };
    });
    type Item = (typeof items)[number];
    // Time order; ties broken by the longer event first.
    const order = [...items].sort((a, b) => a.start - b.start || b.end - a.end);

    let columns: Item[][] = [];
    let clusterEnd = -Infinity;

    const flush = () => {
      const cols = columns.length;
      columns.forEach((col, ci) => {
        for (const ev of col) {
          // Widen into free columns to the right (until one is occupied by an
          // overlapping event).
          let span = 1;
          for (let c = ci + 1; c < cols; c++) {
            if (columns[c].some((o) => o.start < ev.end && ev.start < o.end)) break;
            span++;
          }
          result[ev.i] = {
            leftPct: (ci / cols) * 100,
            widthPct: (span / cols) * 100,
          };
        }
      });
      columns = [];
    };

    for (const ev of order) {
      if (ev.start >= clusterEnd) {
        flush(); // previous cluster is fully in the past — finalize it
        clusterEnd = ev.end;
      } else {
        clusterEnd = Math.max(clusterEnd, ev.end);
      }
      let placed = false;
      for (const col of columns) {
        if (col[col.length - 1].end <= ev.start) {
          col.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([ev]);
    }
    flush();
    return result;
  }

  // Recomputed from persisted entry times (not the live drag) so columns stay
  // stable while a block is being dragged vertically.
  let dayLayout = $derived(
    computeDayLayout(worklogsByDate[dayCell.date]?.entries ?? []),
  );

  /** Click on an empty part of the day timeline → start a new worklog at the
   *  clicked time (snapped). Clicks landing on an existing block are ignored
   *  via the target === currentTarget guard. */
  function onDayGridClick(event: MouseEvent): void {
    if (suppressGridClick) {
      suppressGridClick = false;
      return;
    }
    if (!onAddWorklog || event.target !== event.currentTarget) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = clampNum(
      snapMin(((event.clientY - rect.top) / HOUR_HEIGHT) * 60),
      0,
      24 * 60 - SNAP_MIN,
    );
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    onAddWorklog(dayCell.date, `${hh}:${mm}`);
  }

  /** Arm the inline delete confirm for an entry (first trash click). */
  function requestDeleteEntry(entry: WorklogEntry): void {
    confirmDeleteId = entry.id ?? null;
  }
  function cancelDeleteEntry(): void {
    confirmDeleteId = null;
  }
  /** Actually delete (confirm click). */
  function confirmDeleteEntry(entry: WorklogEntry): void {
    if (!entry.id) return;
    onWorklogDelete?.(entry.id, entry.issueKey, dayCell.date);
    confirmDeleteId = null;
  }

  /** Show the detail popover for a hovered week-timeline block, anchored to
   *  the block itself (reuses the same popover as month view). */
  function showHoverForBlock(event: MouseEvent, date: string, idx: number): void {
    if (dayDrag) return; // don't pop the detail card mid-drag
    clearHoverTimer();
    if (hover?.entryIndex !== idx || hover?.date !== date) confirmDeleteId = null;
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    hover = {
      date,
      entryIndex: idx,
      rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
    };
  }

  /** Click an empty part of a week day-column → add a worklog at that day +
   *  (snapped) time. Clicks on blocks are ignored via target===currentTarget. */
  function onWeekColumnClick(event: MouseEvent, date: string): void {
    if (suppressGridClick) {
      suppressGridClick = false;
      return;
    }
    if (!onAddWorklog || event.target !== event.currentTarget) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = clampNum(
      snapMin(((event.clientY - rect.top) / HOUR_HEIGHT) * 60),
      0,
      24 * 60 - SNAP_MIN,
    );
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    onAddWorklog(date, `${hh}:${mm}`);
  }

  // Hover "slot" indicator on the Day/Week timelines: highlights the hour the
  // pointer is over (where a click would add a worklog), animating in and
  // sliding between hours. `date` identifies the day (Day) or column (Week).
  let hoverSlot = $state<{ date: string; top: number } | null>(null);

  function onSlotMove(event: MouseEvent, date: string): void {
    // Only over an empty part of the timeline (not over a block), not editing.
    if (dayDrag || !onAddWorklog || event.target !== event.currentTarget) {
      if (hoverSlot?.date === date) hoverSlot = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const hour = Math.max(
      0,
      Math.min(23, Math.floor((event.clientY - rect.top) / HOUR_HEIGHT)),
    );
    const top = hour * HOUR_HEIGHT;
    if (hoverSlot?.date !== date || hoverSlot.top !== top) {
      hoverSlot = { date, top };
    }
  }

  function onSlotLeave(date: string): void {
    if (hoverSlot?.date === date) hoverSlot = null;
  }

  function ariaLabelFor(cell: CalCell): string {
    const base = `${formatLocaleDate(cell.date)}, ${cell.hours.toFixed(1)} jam`;
    return cell.holidayName ? `${base}, ${cell.holidayName}` : base;
  }

  const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  // Max worklog rows shown per Month cell before collapsing into "+N more",
  // so the whole month grid fits one screen without page scrolling.
  const MONTH_CELL_MAX = 3;

  // Skeleton sizes per mode.
  const MONTH_SKELETON = Array.from({ length: 42 }, (_, i) => i);
  const WEEK_SKELETON = Array.from({ length: 7 }, (_, i) => i);
</script>

<section
  class="calendar-grid glass"
  aria-labelledby="calendar-grid-heading"
>
  <header class="cal-header">
    <div class="title-block">
      <h2 id="calendar-grid-heading" class="heading">Calendar</h2>
      <p class="period-label" aria-live="polite">
        {#if mode === "day"}
          {dayLabel}
        {:else if mode === "week"}
          {weekLabel}
        {:else}
          {monthLabel}
        {/if}
      </p>
    </div>

    <div class="controls">
      <!-- View mode switcher -->
      <div
        class="mode-switch"
        role="radiogroup"
        aria-label="Mode tampilan kalender"
      >
        {#each VIEW_OPTIONS as opt (opt.value)}
          {@const checked = mode === opt.value}
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            class="mode-chip"
            class:selected={checked}
            onclick={() => setMode(opt.value)}
          >
            <svg
              class="mode-chip-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d={opt.icon} />
            </svg>
            <span class="mode-chip-label">{t(`calendar.${opt.value}`)}</span>
          </button>
        {/each}
      </div>

      <!-- Navigation -->
      <div class="nav-group" aria-label={t("calendar.nextPeriod")}>
        <button
          type="button"
          class="nav-btn"
          aria-label={t("calendar.prevPeriod")}
          onclick={gotoPrev}
        >
          ‹
        </button>
        <button
          type="button"
          class="today-btn"
          onclick={gotoToday}
        >
          {t("calendar.today")}
        </button>
        <button
          type="button"
          class="nav-btn"
          aria-label={t("calendar.nextPeriod")}
          onclick={gotoNext}
        >
          ›
        </button>
      </div>
    </div>
  </header>

  <div class="totals-row">
    <span class="totals-label">{t("calendar.periodTotal")}</span>
    <span class="totals-value">
      {periodTotal.toFixed(1)}<span class="totals-unit">h</span>
    </span>
  </div>

  <!-- Grid body -->
  {#if mode === "list"}
    <div class="groupby-row" role="radiogroup" aria-label="Kelompokkan daftar">
      {#each LIST_GROUP_OPTIONS as opt (opt.value)}
        {@const checked = listGroupBy === opt.value}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          class="groupby-chip"
          class:selected={checked}
          onclick={() => (listGroupBy = opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
    {#if isLoading}
      <ul class="list-skeleton" aria-busy="true" aria-label={t("common.loading")}>
        {#each Array.from({ length: 5 }, (_, i) => i) as i (i)}
          <li class="list-skeleton-row" aria-hidden="true"></li>
        {/each}
      </ul>
    {:else if listGroups.length === 0}
      <p class="list-empty">{t("calendar.emptyList")}</p>
    {:else if listGroupBy === "issue"}
      <ul class="list-groups">
        {#each issueGroups as g, idx (g.issueKey)}
          {@const url = issueUrl(g.issueKey)}
          <li class="list-group" style="--i: {idx};">
            <div class="list-group-header issue-header">
              <span class="list-group-pill issue-pill">
                <span class="issue-share">{issueShare(g.hours)}%</span>
              </span>
              <span class="list-group-meta">
                <span class="list-group-date">
                  {#if url}
                    <a
                      class="issue-group-key"
                      href={url}
                      onclick={(e) => openIssue(e, g.issueKey)}
                      title={`Buka ${g.issueKey} di Jira`}
                    >
                      {g.issueKey}
                    </a>
                  {:else}
                    <span class="issue-group-key">{g.issueKey}</span>
                  {/if}
                  <span class="issue-group-summary">{g.summary || "—"}</span>
                </span>
                <span class="list-group-count">
                  {g.items.length} entri
                </span>
              </span>
              <span class="list-group-hours">
                {g.hours.toFixed(1)}<span class="list-group-unit">h</span>
              </span>
            </div>
            <ul class="list-entries">
              {#each g.items as item, eIdx (eIdx)}
                <li
                  class="list-entry"
                  class:pending={!!item.entry.pending}
                  style="--i: {eIdx};"
                >
                  <span class="entry-key entry-date">{shortDate(item.date)}</span>
                  <span class="entry-desc" title={item.entry.description}>
                    {item.entry.description || "—"}
                  </span>
                  <span class="entry-hours">{item.entry.hours.toFixed(1)}h</span>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="list-groups">
        {#each listGroups as g, idx (g.date)}
          <li class="list-group" style="--i: {idx};">
            <button
              type="button"
              class="list-group-header"
              class:selected={selectedDate === g.date}
              class:today={g.date === todayStr}
              onclick={() => handleSelect(g.date)}
              aria-label={`${formatLocaleDate(g.date)}, ${g.hours.toFixed(1)} jam`}
            >
              <span class="list-group-pill">
                <span class="list-group-day">{dayNumber(g.date)}</span>
                <span class="list-group-month">
                  {parseYMD(g.date).toLocaleDateString("en-GB",{ month: "short" })}
                </span>
              </span>
              <span class="list-group-meta">
                <span class="list-group-date">{formatLocaleDate(g.date)}</span>
                <span class="list-group-count">
                  {g.entries.length} {g.entries.length === 1 ? "entri" : "entri"}
                </span>
              </span>
              <span class="list-group-hours">
                {g.hours.toFixed(1)}<span class="list-group-unit">h</span>
              </span>
            </button>
            <ul class="list-entries">
              {#each g.entries as entry, eIdx (eIdx)}
                {@const url = issueUrl(entry.issueKey)}
                <li class="list-entry" class:pending={!!entry.pending} style="--i: {eIdx};">
                  {#if url}
                    <a
                      class="entry-key"
                      href={url}
                      onclick={(e) => openIssue(e, entry.issueKey)}
                      title={`Buka ${entry.issueKey} di Jira`}
                    >
                      {entry.issueKey}
                    </a>
                  {:else}
                    <span class="entry-key">{entry.issueKey}</span>
                  {/if}
                  <span class="entry-desc" title={entry.description}>
                    {entry.description || "—"}
                  </span>
                  <span class="entry-hours">{entry.hours.toFixed(1)}h</span>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if mode === "day"}
    <div class="day-timeline glass">
      {#if isLoading}
        <div class="day-skeleton" aria-busy="true" aria-label={t("common.loading")}></div>
      {:else}
        {@const entries = worklogsByDate[dayCell.date]?.entries ?? []}
        <div class="timeline-header">
           <span class="timeline-day-name">
             {parseYMD(dayCell.date).toLocaleDateString("en-GB",{ weekday: 'long', day: 'numeric' })}
           </span>
        </div>
        <div class="timeline-scroll-area no-scroll" bind:clientHeight={timelineViewportHeight}>
          <div class="time-axis">
            {#each Array.from({ length: 24 }) as _, h}
              <div class="time-slot">{String(h).padStart(2, '0')}:00</div>
            {/each}
          </div>
          <div
            class="grid-container"
            class:addable={!!onAddWorklog}
            class:weekend={isWeekend(dayCell.date)}
            role="presentation"
            onclick={onDayGridClick}
            onmousemove={(e) => onSlotMove(e, dayCell.date)}
            onmouseleave={() => onSlotLeave(dayCell.date)}
          >
            {#if hasBreak(dayCell.date)}
              <div class="break-band" style={breakBandStyle(dayCell.date)} aria-hidden="true">
                <span class="break-label">{t("calendar.break")}</span>
              </div>
            {/if}
            {#if hoverSlot && hoverSlot.date === dayCell.date}
              <div
                class="hover-slot"
                style="top: {hoverSlot.top}px; height: {HOUR_HEIGHT}px;"
                aria-hidden="true"
              ></div>
            {/if}
            {#each entries as entry, idx (entry.id ?? `${entry.issueKey}-${idx}`)}
              {@const isHoliday = !!dayCell.holidayName || entry.description.toLowerCase().includes('holiday') || entry.issueKey.toLowerCase().includes('holiday')}
              {@const canDrag = dayEditable && !!entry.id}
              <div
                class="worklog-block"
                class:holiday={isHoliday}
                class:default={!isHoliday}
                class:pending={!!entry.pending}
                class:draggable={canDrag}
                class:dragging={!!dayDrag && dayDrag.entryId === entry.id}
                class:compact={liveHours(entry) < 2}
                class:tiny={liveHours(entry) < 0.75}
                role="button"
                tabindex={canDrag ? 0 : -1}
                aria-label={`${entry.issueKey} ${liveStartLabel(entry)}–${liveEndLabel(entry)}, ${liveHours(entry).toFixed(2)} jam`}
                style={blockStyleFor(entry, dayLayout[idx])}
                title={canDrag
                  ? `${entry.issueKey}: ${entry.description}\n(Seret untuk pindah jam, tarik tepi bawah untuk ubah durasi)`
                  : `${entry.issueKey}: ${entry.description}`}
                onpointerdown={(e) => onBlockPointerDown(e, entry, "move", dayCell.date)}
                onmouseleave={() => {
                  if (confirmDeleteId === entry.id) confirmDeleteId = null;
                }}
              >
                <div class="block-time">
                  <span>{liveStartLabel(entry)}</span>
                  <span class="block-time-end">{liveEndLabel(entry)}</span>
                </div>
                <div class="block-content">
                  <div class="block-task-info">
                    <span class="block-key">{entry.issueKey}</span>
                    <span class="block-summary">{entry.summary || "—"}</span>
                  </div>
                  <span class="block-desc">{entry.description || "—"}</span>
                </div>
                <div class="block-hours">{liveHours(entry).toFixed(2)}h</div>
                {#if entry.id && (onWorklogEdit || onWorklogDelete)}
                  <div class="block-actions">
                    {#if onWorklogEdit}
                      <button
                        type="button"
                        class="block-action"
                        aria-label="Edit logwork"
                        title="Edit"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={(e) => {
                          e.stopPropagation();
                          onWorklogEdit?.(entry, dayCell.date);
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    {/if}
                    {#if onWorklogDelete}
                      {#if confirmDeleteId === entry.id}
                        <button
                          type="button"
                          class="block-action confirm-del"
                          aria-label="Konfirmasi hapus logwork"
                          title="Klik untuk menghapus"
                          onpointerdown={(e) => e.stopPropagation()}
                          onclick={(e) => {
                            e.stopPropagation();
                            confirmDeleteEntry(entry);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Hapus
                        </button>
                        <button
                          type="button"
                          class="block-action cancel-del"
                          aria-label="Batal hapus"
                          title="Batal"
                          onpointerdown={(e) => e.stopPropagation()}
                          onclick={(e) => {
                            e.stopPropagation();
                            cancelDeleteEntry();
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="block-action delete"
                          aria-label="Hapus logwork"
                          title="Hapus"
                          onpointerdown={(e) => e.stopPropagation()}
                          onclick={(e) => {
                            e.stopPropagation();
                            requestDeleteEntry(entry);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      {/if}
                    {/if}
                  </div>
                {/if}
                {#if canDrag}
                  <div
                    class="block-resize-handle"
                    role="presentation"
                    onpointerdown={(e) => onBlockPointerDown(e, entry, "resize", dayCell.date)}
                  ></div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else if mode === "week"}
    <div class="week-timeline glass">
      {#if isLoading}
        <div class="day-skeleton" aria-busy="true" aria-label={t("common.loading")}></div>
      {:else}
        <div class="timeline-header week-header">
           <div class="time-axis-spacer"></div>
           {#each weekCells as cell}
             <div class="timeline-day-col-header" class:today={cell.isToday}>
               <span class="day-name">{WEEK_LABELS[parseYMD(cell.date).getDay()]}</span>
               <span class="day-number">{dayNumber(cell.date)}</span>
             </div>
           {/each}
        </div>
        <div class="timeline-scroll-area no-scroll" bind:clientHeight={timelineViewportHeight}>
          <div class="time-axis">
            {#each Array.from({ length: 24 }) as _, h}
              <div class="time-slot">{String(h).padStart(2, '0')}:00</div>
            {/each}
          </div>
          <div class="week-grid-container" bind:this={weekGridEl}>
            {#each weekCells as cell, i (cell.date)}
              {@const entries = worklogsByDate[cell.date]?.entries ?? []}
              {@const layout = computeDayLayout(entries)}
              <div
                class="day-column"
                class:addable={!!onAddWorklog}
                class:weekend={isWeekend(cell.date)}
                class:drop-target={!!dayDrag &&
                  dayDrag.type === "move" &&
                  dayDrag.targetDate === cell.date &&
                  dayDrag.sourceDate !== cell.date}
                role="presentation"
                onclick={(e) => onWeekColumnClick(e, cell.date)}
                onmousemove={(e) => onSlotMove(e, cell.date)}
                onmouseleave={() => onSlotLeave(cell.date)}
              >
                {#if hasBreak(cell.date)}
                  <div class="break-band" style={breakBandStyle(cell.date)} aria-hidden="true">
                    {#if i === 0 || !hasBreak(weekCells[i-1].date)}
                      <span class="break-label">{t("calendar.break")}</span>
                    {/if}
                  </div>
                {/if}
                {#if hoverSlot && hoverSlot.date === cell.date}
                  <div
                    class="hover-slot"
                    style="top: {hoverSlot.top}px; height: {HOUR_HEIGHT}px;"
                    aria-hidden="true"
                  ></div>
                {/if}
                {#each entries as entry, idx (entry.id ?? `${entry.issueKey}-${idx}`)}
                  {@const isHoliday = !!cell.holidayName || entry.description.toLowerCase().includes('holiday') || entry.issueKey.toLowerCase().includes('holiday')}
                  {@const canDrag = dayEditable && !!entry.id}
                  <div
                    class="worklog-block week-block"
                    class:holiday={isHoliday}
                    class:default={!isHoliday}
                    class:pending={!!entry.pending}
                    class:draggable={canDrag}
                    class:dragging={!!dayDrag && dayDrag.entryId === entry.id}
                    class:compact={liveHours(entry) < 2}
                    class:tiny={liveHours(entry) < 0.75}
                    role="button"
                    tabindex={canDrag ? 0 : -1}
                    aria-label={`${entry.issueKey} ${liveStartLabel(entry)}–${liveEndLabel(entry)}, ${liveHours(entry).toFixed(2)} jam`}
                    style={blockStyleFor(entry, layout[idx], 2)}
                    title={canDrag
                      ? `${entry.issueKey}: ${entry.description}\n(Seret untuk pindah hari/jam, tarik tepi bawah untuk durasi)`
                      : `${entry.issueKey}: ${entry.description}`}
                    onpointerdown={(e) => onBlockPointerDown(e, entry, "move", cell.date)}
                    onmouseenter={(e) => showHoverForBlock(e, cell.date, idx)}
                    onmouseleave={scheduleHide}
                  >
                    <div class="block-time">
                      <span>{liveStartLabel(entry)}</span>
                      <span class="block-time-end">{liveEndLabel(entry)}</span>
                    </div>
                    <div class="block-content">
                      <span class="block-key">{shortKey(entry.issueKey)}</span>
                      <span class="block-summary">{entry.summary || "—"}</span>
                      <span class="block-desc">{entry.description || "—"}</span>
                    </div>
                    <div class="block-hours">{liveHours(entry).toFixed(1)}h</div>
                    {#if canDrag}
                      <div
                        class="block-resize-handle"
                        role="presentation"
                        onpointerdown={(e) => onBlockPointerDown(e, entry, "resize", cell.date)}
                      ></div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <ul class="weekday-labels" aria-hidden="true">
      {#each WEEK_LABELS as label (label)}
        <li class="weekday-label">{label}</li>
      {/each}
    </ul>

    {#if isLoading}
      <div
        class="cell-grid skeleton-grid"
        aria-busy="true"
        aria-label={t("common.loading")}
      >
        {#each MONTH_SKELETON as i (i)}
          <div class="cell skeleton-cell" aria-hidden="true"></div>
        {/each}
      </div>
    {:else}
      <div
        class="cell-grid"
      >
        {#each monthCells as cell, i (cell.date)}
          {@const isSelected = selectedDate === cell.date}
          {@const dow = parseYMD(cell.date).getDay()}
          {@const isSunday = dow === 0}
          {@const isSaturday = dow === 6}
          {@const cellEntries = worklogsByDate[cell.date]?.entries ?? []}
          {@const isDragOver = dragOverDate === cell.date}
          <div
            role="button"
            tabindex="0"
            class="cell"
            class:has-hours={cell.hours > 0}
            class:selected={isSelected}
            class:today={cell.isToday}
            class:out-of-month={!cell.inCurrentMonth}
            class:holiday={cell.holidayName !== null}
            class:holiday-national={cell.holidayKind === "national"}
            class:weekend-sunday={isSunday}
            class:weekend-saturday={isSaturday}
            class:drag-over={isDragOver}
            style={`--i: ${i}; ${cell.hours > 0 ? `--cell-bg: ${cell.bg};` : ""}`}
            aria-label={ariaLabelFor(cell)}
            aria-pressed={isSelected}
            onclick={() => openDay(cell.date)}
            onkeydown={(e) => handleCellKeydown(e, cell.date)}
            onmouseenter={(e) => showHoverByPointer(e, cell.date)}
            onmousemove={(e) => moveHoverByPointer(e, cell.date)}
            onmouseleave={scheduleHide}
            onfocus={(e) => showHoverByFocus(e, cell.date)}
            onblur={scheduleHide}
            ondragover={(e) => handleCellDragOver(e, cell.date)}
            ondragleave={(e) => handleCellDragLeave(e, cell.date)}
            ondrop={(e) => handleCellDrop(e, cell.date)}
          >
            <div class="cell-header">
              {#if cell.isToday}
                <span class="cell-day today-pill">{dayNumber(cell.date)}</span>
              {:else}
                <span class="cell-day">{dayNumber(cell.date)}</span>
              {/if}
              {#if cell.hours > 0}
                <span class="cell-hours-mini">
                  {cell.hours.toFixed(1)}<span class="cell-unit">h</span>
                </span>
              {/if}
            </div>
            {#if onAddWorklog}
              <button
                type="button"
                class="cell-add-btn"
                aria-label={`Tambah logwork ${cell.date}`}
                title="Tambah logwork"
                onclick={(e) => {
                  e.stopPropagation();
                  onAddWorklog?.(cell.date);
                }}
                onmousedown={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            {/if}
            {#if cell.holidayName}
              <span class="cell-holiday" title={cell.holidayName}>
                {cell.holidayName}
              </span>
            {/if}
            {#if cellEntries.length > 0}
              <div class="cell-entries">
                {#each cellEntries.slice(0, MONTH_CELL_MAX) as entry, idx (entry.id ?? `${entry.issueKey}-${idx}`)}
                  {@const isDraggable = !!entry.id && !!onWorklogMoved}
                  {@const { h, m } = getStartTime(entry.started)}
                  <!-- `draggable` di-render sebagai string ("true"/"false")
                       karena WebKit (Tauri webview) memerlukan atribut HTML
                       string-typed, bukan boolean Svelte yang kadang
                       di-coerce ke `draggable=""`. -->
                  <div
                    class="cell-entry"
                    class:draggable={isDraggable}
                    draggable={isDraggable ? "true" : "false"}
                    role="button"
                    tabindex="-1"
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                    onmousedown={(e) => e.stopPropagation()}
                    onmouseenter={(e) => { e.stopPropagation(); showHoverByPointer(e, cell.date, idx); }}
                    onmousemove={(e) => { e.stopPropagation(); moveHoverByPointer(e, cell.date, idx); }}
                    onmouseleave={scheduleHide}
                    ondragstart={(e) => handleEntryDragStart(e, entry, cell.date)}
                    ondragend={handleEntryDragEnd}
                  >
                    <span class="cell-entry-time">{liveStartLabel(entry)} – {liveEndLabel(entry)}</span>
                    <span class="cell-entry-key">{shortKey(entry.issueKey)}</span>
                    <span class="cell-entry-hours">{entry.hours.toFixed(1)}h</span>
                  </div>
                {/each}
                {#if cellEntries.length > MONTH_CELL_MAX}
                  <span class="cell-more">+{cellEntries.length - MONTH_CELL_MAX} {t("calendar.more")}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

</section>

<!-- Hover popover: shows the day's worklog entries with clickable Jira
     issue keys. Mounted only while a cell is hovered/focused. -->
{#if hover && hoverPos && mode !== "day"}
  <div
    bind:this={hoverEl}
    class="hover-popover"
    role="tooltip"
    style="top: {hoverPos.top}px; left: {hoverPos.left}px;"
    onmouseenter={cancelHide}
    onmouseleave={scheduleHide}
  >
    <div class="hover-header">
      <span class="hover-date">{formatLocaleDate(hover.date)}</span>
      <span class="hover-total">
        {hoverHours.toFixed(1)}<span class="hover-total-unit">h</span>
      </span>
    </div>
    {#if hoverHolidayName}
      <div
        class="hover-holiday"
        class:national={hoverHolidayKind === "national"}
      >
        <span class="hover-holiday-dot" aria-hidden="true"></span>
        <span class="hover-holiday-name">{hoverHolidayName}</span>
      </div>
    {/if}
    {#if hoverEntries.length === 0}
      <p class="hover-empty">{t("calendar.emptyDay")}</p>
    {:else}
      <ul class="hover-entries">
        {#each hoverEntries as entry, idx (idx)}
          {@const url = issueUrl(entry.issueKey)}
          {@const { h: stH, m: stM } = getStartTime(entry.started)}
          <li class="hover-entry-detailed">
            <div class="hover-entry-top">
              <span class="hover-entry-time-pill">
                {liveStartLabel(entry)} – {liveEndLabel(entry)}
              </span>
              {#if url}
                <a
                  class="hover-entry-key-link"
                  href={url}
                  onclick={(e) => openIssue(e, entry.issueKey)}
                  title={`Buka ${entry.issueKey} di Jira`}
                >
                  {entry.issueKey}
                </a>
              {:else}
                <span class="hover-entry-key-static">{entry.issueKey}</span>
              {/if}
              <span class="hover-entry-duration">{entry.hours.toFixed(1)}h</span>
            </div>
            <div class="hover-entry-body">
              <div class="hover-field">
                <span class="hover-field-label">Task Name</span>
                <p class="hover-field-value">{entry.summary || "—"}</p>
              </div>
              <div class="hover-field">
                <span class="hover-field-label">Comment</span>
                <p class="hover-field-value">{entry.description || "—"}</p>
              </div>
              </div>

              {#if entry.id}
              <div class="hover-entry-actions">
                {#if confirmDeleteId === entry.id}
                  <button
                    type="button"
                    class="hover-action-btn delete"
                    onclick={(e) => {
                      e.stopPropagation();
                      onWorklogDelete?.(entry.id!, entry.issueKey, hover!.date);
                      hover = null;
                      confirmDeleteId = null;
                    }}
                  >
                    <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                    </svg>
                    Ya, hapus
                  </button>
                  <button
                    type="button"
                    class="hover-action-btn cancel"
                    onclick={(e) => {
                      e.stopPropagation();
                      confirmDeleteId = null;
                    }}
                  >
                    Batal
                  </button>
                {:else}
                  <button
                    type="button"
                    class="hover-action-btn edit"
                    onclick={(e) => {
                      e.stopPropagation();
                      onWorklogEdit?.(entry, hover!.date);
                      hover = null;
                    }}
                  >
                    <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    type="button"
                    class="hover-action-btn delete"
                    onclick={(e) => {
                      e.stopPropagation();
                      confirmDeleteId = entry.id ?? null;
                    }}
                  >
                    <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                    </svg>
                    Hapus
                  </button>
                {/if}
              </div>
              {/if}
              </li>
              {/each}
              </ul>
              {/if}

  </div>
{/if}

<style>
  .calendar-grid {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: nowrap;
  }

  .title-block {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 0.75rem;
    min-width: 0;
  }

  .heading {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }

  .period-label {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #f1f5f9;
    text-transform: capitalize;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  /* --- Mode switch --- */

  .mode-switch {
    display: inline-flex;
    padding: 0.125rem;
    gap: 0.125rem;
    border-radius: 0.5rem;
    background: var(--glass-bg-strong);
    border: 1px solid var(--glass-border);
  }

  .mode-chip {
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    transition:
      background-color 200ms ease-out,
      color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .mode-chip-icon {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .mode-chip.selected .mode-chip-icon {
    opacity: 1;
  }

  .mode-chip-label {
    line-height: 1;
  }

  .mode-chip:hover {
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.06);
  }

  .mode-chip:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .mode-chip.selected {
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    color: white;
    box-shadow: 0 2px 10px rgba(99, 102, 241, 0.3);
  }

  /* --- Navigation --- */

  .nav-group {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .nav-btn,
  .today-btn {
    border-radius: 0.375rem;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg-strong);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    font-weight: 500;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .nav-btn {
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    line-height: 1;
  }

  .today-btn {
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
  }

  .nav-btn:hover,
  .today-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: #f8fafc;
  }

  .nav-btn:focus-visible,
  .today-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.6);
  }

  /* --- Totals --- */

  .totals-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--glass-bg-strong);
    border: 1px solid var(--glass-border);
  }

  .totals-label {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }

  .totals-value {
    font-size: 1rem;
    font-weight: 700;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  .totals-unit {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    margin-left: 0.125rem;
  }

  /* --- Weekday labels --- */

  .weekday-labels {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.25rem;
  }

  .weekday-label {
    text-align: center;
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
    padding: 0.125rem 0;
  }

  /* --- Cell grid (week/month) --- */

  .cell-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    grid-template-rows: repeat(6, 1fr);
    gap: 0.25rem;
    flex: 1;
    min-height: 0;
  }

  .cell {
    position: relative;
    min-height: 0;
    padding: 0.375rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: var(--intensity-0);
    color: #f1f5f9;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    text-align: left;
    overflow: hidden;
    animation: cell-enter 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(var(--i, 0) * 12ms);
    transition:
      transform 150ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  @keyframes cell-enter {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .cell:hover {
    transform: translateY(-1px) scale(1.02);
    border-color: rgba(165, 180, 252, 0.35);
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.45);
  }

  .cell:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.6);
  }

  /* Cells without worklogs keep the neutral glass background. Once a
   * day has hours logged, we apply a gradient derived from
   * `colorForHours(hours, baseline)` via the `--cell-bg` CSS var.
   * The gradient softens the edge so the cell still feels integrated
   * with the surrounding glass surface rather than a hard color block. */
  .cell.has-hours {
    background:
      linear-gradient(
        135deg,
        var(--cell-bg) 0%,
        color-mix(in oklab, var(--cell-bg) 70%, transparent) 100%
      );
  }

  .cell.out-of-month {
    opacity: 0.4;
  }

  /* Holiday styling: red accent border + warm background tint so a glance
   * at the calendar surfaces tanggal merah without obscuring worklog
   * intensity colors. The intensity background still shows through with
   * partial transparency. */
  .cell.holiday-national {
    border-color: rgba(248, 113, 113, 0.55);
    background-image: linear-gradient(
      135deg,
      rgba(248, 113, 113, 0.18) 0%,
      rgba(248, 113, 113, 0) 65%
    );
  }

  .cell.holiday-national:hover {
    border-color: rgba(248, 113, 113, 0.85);
    box-shadow: 0 4px 14px rgba(127, 29, 29, 0.45);
  }

  .cell.holiday-national .cell-day:not(.today-pill) {
    color: #fecaca;
  }

  .cell.holiday-national .cell-holiday {
    color: #fecaca;
  }

  /* Company joint-holiday (cuti bersama perusahaan): amber/gold accent
   * so it's clearly distinct from libur nasional resmi. Same dot/label
   * conventions as national holidays for consistency. */
  .cell.holiday-company {
    border-color: rgba(251, 191, 36, 0.55);
    background-image: linear-gradient(
      135deg,
      rgba(251, 191, 36, 0.16) 0%,
      rgba(251, 191, 36, 0) 65%
    );
  }

  .cell.holiday-company:hover {
    border-color: rgba(251, 191, 36, 0.85);
    box-shadow: 0 4px 14px rgba(120, 53, 15, 0.45);
  }

  .cell.holiday-company .cell-day:not(.today-pill) {
    color: #fcd34d;
  }

  .cell.holiday-company .cell-holiday {
    color: #fde68a;
  }

  /* Sunday cells (kolom paling kiri) tinted slightly red because they
   * are weekends in Indonesian convention. Weaker than full holiday
   * styling so users can still distinguish "Minggu biasa" from "tanggal
   * merah resmi". The weekend tint is overridden when the day is also
   * a holiday (national or company) by the rules above. */
  .cell.weekend-sunday:not(.holiday) .cell-day:not(.today-pill),
  .cell.weekend-saturday:not(.holiday) .cell-day:not(.today-pill) {
    color: #fda4af;
  }

  .cell-holiday {
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1.15;
    margin-top: 0.125rem;
    /* Two-line clamp so longer holiday names like "Hari Suci Nyepi
     * (Tahun Baru Saka 1948)" don't blow up the cell height. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
  }

  .cell.today {
    border-color: rgba(99, 102, 241, 0.55);
  }

  .cell.selected {
    border-color: var(--accent-from);
    border-width: 2px;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.35);
  }

  .cell.selected:focus-visible {
    box-shadow:
      var(--focus-ring),
      0 0 0 2px rgba(99, 102, 241, 0.35);
  }

  .cell-day {
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    font-variant-numeric: tabular-nums;
  }

  /* Today indicator: a filled pill that contains just the day number,
   * like the reference event-manager's `bg-primary` ring. */
  .cell-day.today-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
    text-shadow: none;
  }

  .cell.today .cell-day:not(.today-pill) {
    color: #ffffff;
    text-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
  }

  /* Compact total at top-right of cell, used alongside the per-entry chip
   * list so the user still sees the day's aggregate at a glance. */
  .cell-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.125rem;
  }

  .cell-hours-mini {
    font-size: 0.625rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    font-variant-numeric: tabular-nums;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.0625rem 0.25rem;
    border-radius: 0.25rem;
    flex-shrink: 0;
  }

  .cell-unit {
    font-size: 0.625rem;
    margin-left: 0.0625rem;
    color: rgba(255, 255, 255, 0.7);
  }

  /* "Add logwork" affordance — sits in the cell's top-right corner and only
     reveals on hover/focus so the dense month grid stays calm. Clicking it
     opens the Log Work form for this day (without leaving the month view). */
  .cell-add-btn {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    z-index: 2;
    width: 1.25rem;
    height: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 0.375rem;
    background: linear-gradient(135deg, var(--accent-from) 0%, var(--accent-to) 100%);
    color: #fff;
    cursor: pointer;
    opacity: 0;
    transform: scale(0.85);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
    transition:
      opacity 150ms ease-out,
      transform 150ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .cell:hover .cell-add-btn,
  .cell:focus-within .cell-add-btn {
    opacity: 1;
    transform: scale(1);
  }

  .cell-add-btn:hover {
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.55);
  }

  .cell-add-btn:focus-visible {
    opacity: 1;
    transform: scale(1);
    box-shadow: var(--focus-ring);
  }

  .cell-add-btn svg {
    width: 0.875rem;
    height: 0.875rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }

  /* Hide the hours badge while hovering so it doesn't sit under the add
     button — the full total is shown in the hover popover anyway. */
  .cell:hover .cell-hours-mini {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .cell-add-btn {
      transition: none;
    }
  }

  /* -- Per-entry chips & drag-and-drop ------------------------------------ */

  .cell-entries {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
    margin-top: 0.25rem;
    min-height: 0;
  }

  /* "+N more" collapsed indicator — clicking the cell opens the Day view to
     see them all; hovering the cell shows the full list in the popover. */
  .cell-more {
    margin-top: 0.0625rem;
    padding: 0.0625rem 0.25rem;
    font-size: 0.5625rem;
    font-weight: 600;
    color: rgba(199, 210, 254, 0.7);
    cursor: pointer;
  }

  .cell-entry {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.1875rem;
    padding: 0.0625rem 0.25rem;
    border-radius: 0.25rem;
    background: rgba(15, 23, 42, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.625rem;
    line-height: 1.1;
    color: rgba(241, 245, 249, 0.85);
    user-select: none;
    transition:
      background 150ms ease-out,
      border-color 150ms ease-out,
      transform 100ms ease-out;
  }

  .cell-entry.draggable {
    cursor: grab;
    /* WebKit (Tauri webview di macOS) butuh hint eksplisit ini agar
     * `<div draggable="true">` benar-benar menginisiasi drag — tanpa
     * properti ini, browser hanya menggeser caret teks alih-alih memicu
     * event `dragstart`. */
    -webkit-user-drag: element;
  }

  .cell-entry.draggable:hover {
    background: rgba(99, 102, 241, 0.22);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .cell-entry.draggable:active {
    cursor: grabbing;
    transform: scale(0.98);
  }

  .cell-entry-time {
    font-size: 0.5625rem;
    font-weight: 600;
    color: #10b981; /* Matching the Emerald Green from your timesheet ref */
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cell-entry-key {
    font-weight: 700;
    color: #c7d2fe;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .cell-entry-hours {
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
  }

  /* Drop-target highlight while a worklog chip is being dragged over a
   * different cell. Strong border + faint inner glow so it reads even
   * over colored cells (intensity gradient). */
  .cell.drag-over {
    border-color: rgba(99, 102, 241, 0.85);
    box-shadow:
      0 0 0 2px rgba(99, 102, 241, 0.35),
      inset 0 0 16px rgba(99, 102, 241, 0.18);
  }

  /* --- Skeleton --- */

  .skeleton-cell {
    cursor: default;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    border-color: rgba(255, 255, 255, 0.04);
  }

  .skeleton-cell:hover {
    transform: none;
    border-color: rgba(255, 255, 255, 0.04);
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* --- Week view (Timeline) --- */

  .week-timeline {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--glass-bg-strong);
    border-radius: 0.875rem;
    overflow: hidden;
    animation: timeline-enter 400ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .week-header {
    display: grid;
    grid-template-columns: 4.5rem repeat(7, 1fr);
    padding: 0 !important; /* Override .timeline-header padding */
    text-align: center;
    flex-shrink: 0;
  }

  .time-axis-spacer {
    border-right: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.03);
  }

  .timeline-day-col-header {
    display: flex;
    flex-direction: column;
    padding: 0.25rem 0.25rem;
    border-right: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.02);
  }

  .timeline-day-col-header:last-child {
    border-right: none;
  }

  .timeline-day-col-header.today {
    background: rgba(99, 102, 241, 0.08);
  }

  .day-name {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 0;
  }

  .day-number {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .timeline-day-col-header.today .day-number {
    color: #818cf8;
  }

  .week-grid-container {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    position: relative;
    height: 100%;
    background-image: linear-gradient(var(--glass-border) 1px, transparent 1px);
    background-size: 100% calc(100% / 24);
  }

  .day-column {
    position: relative;
    border-right: 1px solid var(--glass-border);
    height: 100%;
  }

  .day-column:last-child {
    border-right: none;
  }

  .week-block {
    left: 2px;
    right: 2px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0.125rem 0.25rem;
    gap: 0.0625rem;
  }

  /* Empty column area is clickable to log a new entry at that day + time. */
  .day-column.addable {
    cursor: pointer;
  }

  /* Column highlighted as the drop target while dragging a block across days. */
  .day-column.drop-target {
    background-color: rgba(99, 102, 241, 0.14);
    box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.55);
  }

  /* Weekend (Sat/Sun): vertical red wash top-to-bottom. The grid's hour lines
     show through the translucent tint. No lunch break is rendered on weekends. */
  .day-column.weekend {
    background-image: linear-gradient(
      180deg,
      rgba(239, 68, 68, 0.16) 0%,
      rgba(239, 68, 68, 0.04) 100%
    );
  }

  .grid-container.weekend {
    background-image:
      linear-gradient(
        180deg,
        rgba(239, 68, 68, 0.16) 0%,
        rgba(239, 68, 68, 0.04) 100%
      ),
      linear-gradient(var(--glass-border) 1px, transparent 1px);
    background-size:
      100% 100%,
      100% 64px;
  }

  .week-block .block-time {
    min-width: unset;
    font-size: 0.5625rem;
    flex-direction: row;
    gap: 0.125rem;
  }

  .week-block .block-summary,
  .week-block .block-desc {
    display: none;
  }

  .week-block .block-key {
    font-size: 0.5625rem;
  }

  .week-block .block-hours {
    font-size: 0.5625rem;
  }

  .week-block .block-content {
    flex-direction: row;
    align-items: center;
    gap: 0.25rem;
  }

  .week-block .block-time-end::before {
    content: "–";
    margin: 0 0.125rem;
  }

  .day-timeline {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--glass-bg-strong);
    border-radius: 0.875rem;
    overflow: hidden;
    animation: timeline-enter 400ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  @keyframes timeline-enter {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .timeline-header {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(30, 41, 59, 0.45);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    flex-shrink: 0;
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .sticky-header {
    position: sticky;
    top: 0;
    z-index: 20;
    grid-column: 1 / -1;
  }

  .timeline-day-col-header {
    font-size: 1rem;
    font-weight: 700;
    color: #ffffff;
    text-transform: capitalize;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .timeline-day-name {
    font-size: 1rem;
    font-weight: 700;
    color: #ffffff;
    text-transform: capitalize;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .timeline-scroll-area {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    position: relative;
    /* Hide scrollbar for cleaner look, or style it if needed */
    scrollbar-width: thin;
    scrollbar-color: var(--glass-border) transparent;
  }

  .timeline-scroll-area.no-scroll {
    overflow-y: hidden;
  }

  .time-axis {
    border-right: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.01);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .time-slot {
    flex: 1; /* Scale to fit */
    min-height: 0;
    padding: 0 0.875rem 0 0;
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    font-size: 0.625rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.4);
    font-variant-numeric: tabular-nums;
  }

  .grid-container {
    position: relative;
    height: 100%;
    /* Horizontal grid lines */
    background-image: linear-gradient(var(--glass-border) 1px, transparent 1px);
    background-size: 100% calc(100% / 24);
  }

  /* Empty timeline area is clickable to log a new entry at that time. */
  .grid-container.addable {
    cursor: pointer;
  }

  /* Hovered hour "slot" — where a click would add a worklog. Animates in and
     slides between hours as the pointer moves. Sits below the worklog blocks. */
  .hover-slot {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    pointer-events: none;
    border-radius: 0.5rem;
    background: rgba(99, 102, 241, 0.13);
    box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.4);
    transition: top 130ms cubic-bezier(0.22, 1, 0.36, 1);
    animation: slot-in 170ms ease-out;
  }

  @keyframes slot-in {
    from {
      opacity: 0;
      transform: scaleY(0.6);
    }
    to {
      opacity: 1;
      transform: scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hover-slot {
      transition: none;
      animation: none;
    }
  }

  /* Lunch-break band — a striped amber zone marking non-working hours.
     Purely decorative (pointer-events: none) so logging is still allowed. */
  .break-band {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      45deg,
      rgba(245, 158, 11, 0.12),
      rgba(245, 158, 11, 0.12) 8px,
      rgba(245, 158, 11, 0.04) 8px,
      rgba(245, 158, 11, 0.04) 16px
    );
    border-top: 1px dashed rgba(245, 158, 11, 0.45);
    border-bottom: 1px dashed rgba(245, 158, 11, 0.45);
  }

  .break-label {
    position: absolute;
    top: 50%;
    left: 0.75rem;
    transform: translateY(-50%);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(251, 191, 36, 0.95);
    pointer-events: none;
  }

  .worklog-block {
    position: absolute;
    left: 12px;
    right: 12px;
    border-radius: 0.5rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.8125rem;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.875rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    border-left: 4px solid;
    transition:
      transform 150ms ease-out,
      filter 150ms ease-out,
      box-shadow 150ms ease-out;
    overflow: hidden;
    cursor: default;
  }

  .worklog-block:hover {
    filter: brightness(1.15);
    transform: translateY(-1px) scale(1.005);
    z-index: 10;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }

  .worklog-block.default {
    background: rgba(99, 102, 241, 0.15);
    border-color: #6366f1;
    color: #e0e7ff;
  }

  .worklog-block.holiday {
    background: rgba(16, 185, 129, 0.15);
    border-color: #10b981;
    color: #d1fae5;
  }

  /* Entri draf (belum disubmit ke Jira) — garis putus-putus + warna kuning
     agar jelas berbeda dari worklog yang sudah tersimpan. */
  .worklog-block.pending {
    background: rgba(252, 211, 77, 0.12);
    border: 1px dashed rgba(252, 211, 77, 0.65);
    border-left: 4px dashed #fcd34d;
    color: #fef3c7;
  }

  .block-time {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    font-size: 0.75rem;
    font-weight: 700;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
    min-width: 2.75rem;
  }

  /* End time sits under the start, dimmer, so the pair reads as a range. */
  .block-time-end {
    font-weight: 500;
    opacity: 0.6;
  }

  /* Sub-hour blocks are too short for the stacked layout, so collapse to a
     single row: time range, key + description, and hours all inline with
     tight padding. The full text stays reachable via the block's tooltip. */
  .worklog-block.compact {
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    gap: 0.5rem;
  }

  .worklog-block.compact .block-time {
    flex-direction: row;
    align-items: baseline;
    line-height: 1;
  }

  .worklog-block.compact .block-time-end {
    opacity: 0.55;
  }

  .worklog-block.compact .block-time-end::before {
    content: "–";
    margin: 0 0.2rem;
  }

  .worklog-block.compact .block-content {
    flex-direction: row;
    align-items: baseline;
    gap: 0.5rem;
    overflow: hidden;
  }

  .worklog-block.compact .block-desc {
    display: none;
  }

  .worklog-block.compact .block-task-info {
    gap: 0.375rem;
  }

  /* Very short blocks (< 45min): show only key + hours in a single centered row */
  .worklog-block.tiny {
    padding: 0 0.375rem;
    font-size: 0.625rem;
    gap: 0.25rem;
    align-items: center;
  }

  .worklog-block.tiny .block-time {
    display: none;
  }

  .worklog-block.tiny .block-content {
    flex-direction: row;
    align-items: center;
    gap: 0.25rem;
    overflow: hidden;
  }

  .worklog-block.tiny .block-desc,
  .worklog-block.tiny .block-summary {
    display: none;
  }

  .worklog-block.tiny .block-key {
    font-size: 0.625rem;
  }

  .worklog-block.tiny .block-hours {
    font-size: 0.625rem;
  }

  .block-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    /* Clip the (potentially long) description here now that the block itself
       no longer clips, so a short block's action buttons can overflow. */
    overflow: hidden;
  }

  .block-task-info {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    overflow: hidden;
  }

  .block-summary {
    font-weight: 600;
    color: #ffffff;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .block-key {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .block-desc {
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.75rem;
    font-style: italic;
  }

  .block-hours {
    font-weight: 700;
    font-size: 0.875rem;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  /* Edit / delete actions — revealed on hover/focus in place of the hours
     readout, so each day-view block can be edited or removed in place. */
  .block-actions {
    position: absolute;
    top: 50%;
    right: 0.5rem;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 150ms ease-out;
    z-index: 3;
  }

  .worklog-block:hover .block-actions,
  .worklog-block:focus-within .block-actions {
    opacity: 1;
  }

  .worklog-block:hover .block-hours,
  .worklog-block:focus-within .block-hours {
    opacity: 0;
  }

  .block-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.625rem;
    height: 1.625rem;
    padding: 0;
    border: none;
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    cursor: pointer;
    transition: background 150ms ease-out;
    outline: none;
  }

  .block-action:hover {
    background: rgba(255, 255, 255, 0.28);
  }

  .block-action.delete:hover {
    background: rgba(239, 68, 68, 0.85);
  }

  /* Inline delete confirmation. */
  .block-action.confirm-del {
    width: auto;
    gap: 0.25rem;
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    font-weight: 700;
    background: rgba(239, 68, 68, 0.92);
  }

  .block-action.confirm-del:hover {
    background: rgb(239, 68, 68);
  }

  .block-action.cancel-del {
    background: rgba(255, 255, 255, 0.2);
  }

  .block-action.cancel-del:hover {
    background: rgba(255, 255, 255, 0.32);
  }

  .block-action:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .block-action svg {
    width: 0.9375rem;
    height: 0.9375rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .worklog-block.compact .block-action {
    width: 1.375rem;
    height: 1.375rem;
  }

  /* The "Hapus" confirm button has a text label, so keep it auto-width even in
     compact blocks (the icon-only rule above must not squash it). */
  .worklog-block.compact .block-action.confirm-del {
    width: auto;
    height: 1.375rem;
  }

  /* --- Day-view drag-to-move / resize ------------------------------------ */
  .worklog-block.draggable {
    cursor: grab;
    /* Stop touch scroll/gesture from hijacking the drag. */
    touch-action: none;
  }

  .worklog-block.dragging {
    cursor: grabbing;
    z-index: 5;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    filter: brightness(1.06);
    /* Follow the pointer 1:1 — no easing on position while dragging. */
    transition: none;
    user-select: none;
  }

  /* Bottom edge: drag to change duration. */
  .block-resize-handle {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 10px;
    cursor: ns-resize;
    touch-action: none;
  }

  /* Grip hint that fades in when hovering a draggable block. */
  .worklog-block.draggable:hover .block-resize-handle::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 3px;
    transform: translateX(-50%);
    width: 1.75rem;
    height: 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
  }

  @media (prefers-reduced-motion: reduce) {
    .worklog-block.dragging {
      filter: none;
    }
  }

  .day-skeleton {
    height: 100%;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .day-empty {
    margin: 1.5rem;
    padding: 1.5rem;
    border-radius: 0.75rem;
    background: var(--glass-bg-strong);
    border: 1px dashed var(--glass-border);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;
    text-align: center;
  }

  /* --- Hover popover (week / month) --- */

  .hover-popover {
    position: fixed;
    z-index: 40;
    width: 20rem;
    max-width: calc(100vw - 1rem);
    /* Grow taller on roomy screens but never spill past the viewport. */
    max-height: min(640px, calc(100vh - 2rem));
    overflow-y: auto;
    padding: 0.75rem;
    border-radius: 0.75rem;
    /* Near-opaque dark surface so worklog details are legible above the
     * underlying calendar cells and the heatmap. */
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
    color: #f1f5f9;
    pointer-events: auto;
    animation: hover-fade-in 120ms ease-out;
  }

  @keyframes hover-fade-in {
    from { opacity: 0; transform: translateY(-2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .hover-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .hover-holiday {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    /* Default tint (used if for some reason kind isn't applied yet). */
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.32);
  }

  .hover-holiday.national {
    background: rgba(248, 113, 113, 0.12);
    border-color: rgba(248, 113, 113, 0.32);
  }

  .hover-holiday.company {
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.32);
  }

  .hover-holiday-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #f87171;
    box-shadow: 0 0 6px rgba(248, 113, 113, 0.6);
    flex-shrink: 0;
  }

  .hover-holiday.company .hover-holiday-dot {
    background: #fbbf24;
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.6);
  }

  .hover-holiday-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: #fecaca;
    line-height: 1.25;
  }

  .hover-holiday.company .hover-holiday-name {
    color: #fde68a;
  }

  .hover-date {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #f8fafc;
  }

  .hover-total {
    font-size: 0.875rem;
    font-weight: 700;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  .hover-total-unit {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.7);
    margin-left: 0.0625rem;
  }

  .hover-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
    padding: 0.5rem 0;
  }

  .hover-entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    /* No inner scroll: the popover itself scrolls so the entry can use the
       full popover height, and the action bar below can pin to the bottom. */
  }

  .hover-entry {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.375rem 0.5rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    font-size: 0.8125rem;
  }

  .hover-entry-detailed {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 0.5rem;
  }

  .hover-entry-detailed:last-child {
    margin-bottom: 0;
  }

  .hover-entry-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .hover-entry-time-pill {
    font-size: 0.6875rem;
    font-weight: 700;
    color: #10b981;
    background: rgba(16, 185, 129, 0.12);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-variant-numeric: tabular-nums;
  }

  .hover-entry-key-link,
  .hover-entry-key-static {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 700;
    color: #c7d2fe;
    font-size: 0.8125rem;
  }

  .hover-entry-key-link {
    text-decoration: none;
    border-bottom: 1px dashed rgba(199, 210, 254, 0.3);
    transition: color 200ms ease-out, border-color 200ms ease-out;
  }

  .hover-entry-key-link:hover {
    color: #ffffff;
    border-bottom-color: #ffffff;
  }

  .hover-entry-duration {
    margin-left: auto;
    font-weight: 700;
    color: #ffffff;
    font-size: 0.8125rem;
  }

  .hover-entry-body {
    padding-top: 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hover-field {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .hover-field-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.35);
  }

  .hover-field-value {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.9);
    word-break: break-word;
  }

  .hover-entry-actions {
    /* Pinned to the bottom of the scrolling popover so Edit/Hapus stay
       reachable without scrolling, even with a long comment above. */
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    gap: 0.5rem;
    /* Bleed into the card's padding so the bar spans full width and its
       rounded corners line up with the card's bottom edge. */
    margin: 0.75rem -0.75rem -0.75rem;
    padding: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom-left-radius: 0.625rem;
    border-bottom-right-radius: 0.625rem;
    /* Opaque surface so the scrolling comment never shows through the bar. */
    background: rgba(15, 23, 42, 0.98);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  .hover-action-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 150ms ease-out;
  }

  .hover-action-btn.edit {
    background: rgba(99, 102, 241, 0.15);
    color: #a5b4fc;
    border-color: rgba(99, 102, 241, 0.3);
  }

  .hover-action-btn.edit:hover {
    background: rgba(99, 102, 241, 0.25);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .hover-action-btn.delete {
    background: rgba(244, 63, 94, 0.15);
    color: #fda4af;
    border-color: rgba(244, 63, 94, 0.3);
  }

  .hover-action-btn.delete:hover {
    background: rgba(244, 63, 94, 0.25);
    border-color: rgba(244, 63, 94, 0.5);
  }

  .hover-action-btn.cancel {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border-color: rgba(255, 255, 255, 0.14);
  }

  .hover-action-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .action-icon {
    width: 0.875rem;
    height: 0.875rem;
  }

  .hover-entry-key {
    font-weight: 600;
    color: #c7d2fe;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    border-bottom: 1px dashed transparent;
    transition:
      color 200ms ease-out,
      border-color 200ms ease-out;
  }

  a.hover-entry-key {
    cursor: pointer;
  }

  a.hover-entry-key:hover,
  a.hover-entry-key:focus-visible {
    color: #e0e7ff;
    border-bottom-color: rgba(199, 210, 254, 0.55);
    outline: none;
  }

  .hover-entry-key.static {
    cursor: default;
  }

  .hover-entry-desc {
    color: rgba(255, 255, 255, 0.78);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .hover-entry-hours {
    font-weight: 600;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  /* --- List view --- */

  .list-empty {
    margin: 0;
    padding: 1.5rem 1rem;
    border-radius: 0.625rem;
    background: var(--glass-bg-strong);
    border: 1px dashed var(--glass-border);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;
    text-align: center;
  }

  .list-skeleton {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .list-skeleton-row {
    height: 4rem;
    flex-shrink: 0;
    border-radius: 0.625rem;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .list-groups {
    list-style: none;
    margin: 0;
    padding: 0 0.375rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    /* Claim the leftover column height and scroll internally — the same
       shape as `.cell-grid` (Month) and `.day-timeline` (Day). Without
       `min-height: 0` a flex item refuses to shrink below its content, so
       a long month overflowed the card and got clipped by the shell's
       `overflow: hidden`, leaving the tail unreachable. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--glass-border) transparent;
  }

  .list-group {
    /* Stagger entrance: each group fades + slides in based on its index.
       Capped: a full month can run past 20 groups, and with `both` fill the
       later ones would still be at opacity 0 when the user scrolls to
       them. */
    animation: list-group-enter 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(min(var(--i, 0), 8) * 50ms);
    border-radius: 0.75rem;
    background: var(--glass-bg-strong);
    border: 1px solid var(--glass-border);
    overflow: hidden;
    /* Keep each group at its natural height. Flex items default to
       `flex-shrink: 1`, so inside a height-constrained column they compress
       to fit instead of overflowing — the scroll container would then never
       have anything to scroll and the rows collapse into slivers. */
    flex-shrink: 0;
  }

  @keyframes list-group-enter {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* --- List: pengelompokan (per tanggal / per issue) ------------------- */

  .groupby-row {
    display: flex;
    gap: 0.375rem;
    padding: 0 0.25rem 0.625rem;
    flex-shrink: 0;
  }

  .groupby-chip {
    padding: 0.3125rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 180ms ease-out,
      color 180ms ease-out,
      border-color 180ms ease-out;
    outline: none;
  }

  .groupby-chip:hover:not(.selected) {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.85);
  }

  .groupby-chip.selected {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.55);
    color: #e0e7ff;
  }

  .groupby-chip:focus-visible {
    box-shadow: var(--focus-ring);
  }

  /* Header kelompok issue: non-interaktif (tidak memilih tanggal), jadi
     tanpa cursor/hover milik varian tanggal. */
  .issue-header {
    cursor: default;
  }

  .issue-header:hover {
    background: transparent;
  }

  .issue-pill {
    background: rgba(99, 102, 241, 0.16);
    border-color: rgba(99, 102, 241, 0.4);
  }

  .issue-share {
    font-size: 0.8125rem;
    font-weight: 700;
    color: #c7d2fe;
    font-variant-numeric: tabular-nums;
  }

  .issue-group-key {
    font-weight: 700;
    color: #a5b4fc;
    text-decoration: none;
  }

  .issue-group-key:hover {
    text-decoration: underline;
  }

  .issue-group-summary {
    margin-left: 0.5rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
  }

  /* Kolom tanggal menggantikan issue key di baris kelompok issue. Ditulis
     dua-kelas agar menang atas `.entry-key` yang dideklarasikan lebih
     bawah — keduanya sama-sama satu kelas, jadi urutanlah penentunya. */
  .entry-key.entry-date {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .list-group-header {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.875rem;
    align-items: center;
    padding: 0.75rem 0.875rem;
    border: none;
    background: transparent;
    color: #f1f5f9;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .list-group-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .list-group-header:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .list-group-header.selected {
    background: rgba(99, 102, 241, 0.12);
    box-shadow: inset 3px 0 0 var(--accent-from);
  }

  .list-group-pill {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out;
  }

  .list-group-header.today .list-group-pill {
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    border-color: transparent;
    box-shadow: 0 2px 10px rgba(99, 102, 241, 0.4);
  }

  .list-group-day {
    font-size: 1rem;
    font-weight: 700;
    line-height: 1;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  .list-group-month {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.7);
    margin-top: 0.125rem;
  }

  .list-group-header.today .list-group-month {
    color: rgba(255, 255, 255, 0.9);
  }

  .list-group-meta {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .list-group-date {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-group-count {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .list-group-hours {
    font-size: 1.125rem;
    font-weight: 700;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .list-group-unit {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    margin-left: 0.0625rem;
  }

  .list-entries {
    list-style: none;
    margin: 0;
    padding: 0 0.625rem 0.625rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .list-entry {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.625rem;
    align-items: center;
    padding: 0.5rem 0.625rem;
    margin-top: 0.5rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.03);
    font-size: 0.8125rem;
    /* Stagger entries inside a group on top of the group's own delay. */
    animation: list-entry-enter 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(min(var(--i, 0), 8) * 35ms + 200ms);
  }

  /* The three entry columns carried no colour of their own, so they fell
     back to the document default — black on a dark card, i.e. invisible.
     Nothing in the ancestor chain (.list-entries → .calendar-grid →
     .workspace-shell → body) sets one either, so they need explicit values. */
  .entry-key {
    font-weight: 600;
    color: #a5b4fc;
    text-decoration: none;
    white-space: nowrap;
  }

  a.entry-key:hover,
  a.entry-key:focus-visible {
    text-decoration: underline;
  }

  .entry-desc {
    color: rgba(255, 255, 255, 0.75);
    min-width: 0;
  }

  .entry-hours {
    font-weight: 600;
    color: #f1f5f9;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Entri draf di list view — tandai dengan garis putus-putus + label. */
  .list-entry.pending {
    border: 1px dashed rgba(252, 211, 77, 0.5);
    background: rgba(252, 211, 77, 0.06);
  }

  .list-entry.pending .entry-desc::after {
    content: " · draf";
    color: #fcd34d;
    font-weight: 600;
  }

  @keyframes list-entry-enter {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* --- Reduced motion --- */

  @media (prefers-reduced-motion: reduce) {
    .cell,
    .day-card,
    .mode-chip,
    .nav-btn,
    .today-btn,
    .list-group,
    .list-entry,
    .list-group-pill,
    .list-group-header {
      transition: none;
      animation: none;
    }
    .cell:hover,
    .day-card:hover {
      transform: none;
    }
    .skeleton-cell,
    .day-skeleton,
    .list-skeleton-row {
      animation: none;
    }
    .hover-popover {
      animation: none;
    }
  }

  /* --- Responsive --- */

  @media (max-width: 640px) {
    .cell {
      min-height: 3rem;
      padding: 0.375rem;
    }
    .cell-day {
      font-size: 0.75rem;
    }
    .cell-hours-mini {
      font-size: 0.5625rem;
      padding: 0.0625rem 0.25rem;
    }
    .cell-entry {
      font-size: 0.5625rem;
      padding: 0.0625rem 0.25rem;
    }
    .period-label {
      font-size: 1rem;
    }
  }
</style>
