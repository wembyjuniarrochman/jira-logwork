<script lang="ts">
  /**
   * QuickLogApp — Mini window untuk input worklog cepat dari system tray.
   *
   * Fitur:
   * - Recent issues (shared via Tauri plugin-store)
   * - Duration preset chips + custom input
   * - Date picker, description
   * - Timer integration (backend state)
   * - Today's summary + Weekly progress
   * - Repeat Last Log
   * - Multi-log / Batch mode
   * - Issue Search (query Jira)
   * - Quick Log Templates
   * - Clipboard Detection (auto-detect issue key)
   * - Notification Reminder + Timer Notification handling
   */

  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { sendNotification } from "@tauri-apps/plugin-notification";
  import {
    loadRecentIssues,
    saveRecentIssues,
    upsertRecentIssue,
    type RecentIssue,
  } from "../stores/recentIssuesStore";

  // --- Types ---
  interface TimerState {
    issue_key: string | null;
    summary: string | null;
    start_time: number | null;
    accumulated_seconds: number;
    running: boolean;
  }

  interface Credentials {
    baseUrl: string;
    email: string;
    apiToken: string;
    isCloud: boolean;
  }

  interface LogEntry {
    id: string;
    issueKey: string;
    summary: string;
    durationMinutes: number;
    description: string;
    date: string;
  }

  interface Template {
    id: string;
    name: string;
    issueKey: string;
    summary: string;
    durationMinutes: number;
    description: string;
  }

  interface SearchResult {
    key: string;
    summary: string;
  }

  // --- State ---
  let credentials = $state<Credentials | null>(null);
  let recentIssues = $state<RecentIssue[]>([]);
  let selectedIssueKey = $state("");
  let selectedSummary = $state("");
  let durationMinutes = $state(60);
  let customDuration = $state("");
  let useCustom = $state(false);
  let description = $state("");
  let logDate = $state(todayYMD());
  let submitting = $state(false);
  let submitResult = $state<{ ok: boolean; msg: string } | null>(null);
  let timerState = $state<TimerState | null>(null);
  let todayHours = $state<number>(0);
  let weeklyHours = $state<number>(0);
  let loading = $state(true);

  // Batch mode
  let batchMode = $state(false);
  let batchEntries = $state<LogEntry[]>([]);

  // Search
  let searchQuery = $state("");
  let searchResults = $state<SearchResult[]>([]);
  let searchLoading = $state(false);
  let showSearchResults = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Templates
  let templates = $state<Template[]>([]);
  let showTemplates = $state(false);

  // Last log (repeat)
  let lastLog = $state<{ issueKey: string; summary: string; durationMinutes: number; description: string } | null>(null);

  // Duration presets
  const PRESETS = [
    { label: "15m", mins: 15 },
    { label: "30m", mins: 30 },
    { label: "1h", mins: 60 },
    { label: "2h", mins: 120 },
    { label: "4h", mins: 240 },
    { label: "8h", mins: 480 },
  ];

  const WEEKLY_TARGET = 40;

  function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function mondayOfWeek(): string {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
  }

  function genId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  // --- Init ---
  async function init() {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      const baseUrl = (await store.get<string>("baseUrl")) ?? "";
      const email = (await store.get<string>("email")) ?? "";
      const apiToken = (await store.get<string>("apiToken")) ?? "";
      const isCloud = (await store.get<boolean>("isCloud")) ?? true;

      if (baseUrl && email && apiToken) {
        credentials = { baseUrl, email, apiToken, isCloud };
        recentIssues = await loadRecentIssues(email);
        timerState = await invoke<TimerState>("get_timer_state");

        if (timerState?.issue_key) {
          selectedIssueKey = timerState.issue_key;
          selectedSummary = timerState.summary ?? "";
          if (timerState.accumulated_seconds > 0 || timerState.running) {
            let secs = timerState.accumulated_seconds;
            if (timerState.running && timerState.start_time) {
              secs += (Date.now() - timerState.start_time) / 1000;
            }
            durationMinutes = Math.max(1, Math.round(secs / 60));
            useCustom = true;
            customDuration = String(durationMinutes);
          }
        }

        // Load templates
        try {
          const tplStore = await load("quicklog-templates.json");
          const tpls = await tplStore.get<Template[]>("templates");
          if (Array.isArray(tpls)) templates = tpls;
        } catch {}

        // Load last log
        try {
          const llStore = await load("quicklog-lastlog.json");
          const ll = await llStore.get<typeof lastLog>("lastLog");
          if (ll && ll.issueKey) lastLog = ll;
        } catch {}

        // Clipboard detection
        try {
          const clipText = await navigator.clipboard.readText();
          const match = clipText?.match(/[A-Z][A-Z0-9]+-\d+/);
          if (match && !selectedIssueKey) {
            selectedIssueKey = match[0];
          }
        } catch {}

        await loadTodaySummary();
        await loadWeeklySummary();
      }
    } catch {}
    loading = false;
  }

  async function loadTodaySummary() {
    if (!credentials) return;
    try {
      const today = todayYMD();
      const result = await invoke<string>("get_my_worklogs", {
        baseUrl: credentials.baseUrl,
        email: credentials.email,
        apiToken: credentials.apiToken,
        isCloud: credentials.isCloud,
        startDate: today,
        endDate: today,
      });
      const data = JSON.parse(result);
      let total = 0;
      for (const issue of data.issues ?? []) {
        for (const wl of issue.fields?.worklog?.worklogs ?? []) {
          total += (wl.timeSpentSeconds ?? 0) / 3600;
        }
      }
      todayHours = Math.round(total * 100) / 100;

      // Update tray tooltip
      const status = todayHours >= 8 ? "✓" : todayHours > 0 ? "◐" : "○";
      invoke("update_tray_tooltip", { status: `JIRA Logwork — ${status} ${todayHours}h hari ini` }).catch(() => {});
    } catch { todayHours = 0; }
  }

  async function loadWeeklySummary() {
    if (!credentials) return;
    try {
      const result = await invoke<string>("get_my_worklogs", {
        baseUrl: credentials.baseUrl,
        email: credentials.email,
        apiToken: credentials.apiToken,
        isCloud: credentials.isCloud,
        startDate: mondayOfWeek(),
        endDate: todayYMD(),
      });
      const data = JSON.parse(result);
      let total = 0;
      for (const issue of data.issues ?? []) {
        for (const wl of issue.fields?.worklog?.worklogs ?? []) {
          total += (wl.timeSpentSeconds ?? 0) / 3600;
        }
      }
      weeklyHours = Math.round(total * 100) / 100;
    } catch { weeklyHours = 0; }
  }

  // --- Event listeners ---
  listen("reminder-check", () => {
    if (todayHours < 1) {
      sendNotification({
        title: "JIRA Logwork Reminder",
        body: "Kamu belum log worklog hari ini. Klik tray → Quick Log.",
      });
    }
  });

  listen("timer-long-running", () => {
    sendNotification({
      title: "Timer Terlalu Lama",
      body: "Timer sudah berjalan lebih dari 4 jam. Mau stop dan log?",
    });
  });

  // --- Issue search ---
  function onSearchInput() {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!searchQuery.trim() || !credentials) {
      searchResults = [];
      showSearchResults = false;
      return;
    }
    searchTimeout = setTimeout(async () => {
      searchLoading = true;
      showSearchResults = true;
      try {
        const raw = await invoke<string>("search_issues", {
          baseUrl: credentials!.baseUrl,
          email: credentials!.email,
          apiToken: credentials!.apiToken,
          isCloud: credentials!.isCloud,
          projectKey: searchQuery.split("-")[0] || "",
          query: searchQuery,
        });
        const data = JSON.parse(raw);
        searchResults = (data.issues ?? []).slice(0, 8).map((i: any) => ({
          key: i.key,
          summary: i.fields?.summary ?? "",
        }));
      } catch {
        searchResults = [];
      }
      searchLoading = false;
    }, 400);
  }

  function selectSearchResult(r: SearchResult) {
    selectedIssueKey = r.key;
    selectedSummary = r.summary;
    searchQuery = "";
    showSearchResults = false;
  }

  // --- Actions ---
  function selectIssue(issue: RecentIssue) {
    selectedIssueKey = issue.issueKey;
    selectedSummary = issue.summary;
  }

  function selectPreset(mins: number) {
    useCustom = false;
    durationMinutes = mins;
  }

  function activateCustom() {
    useCustom = true;
    customDuration = String(durationMinutes);
  }

  function getEffectiveDurationMinutes(): number {
    if (useCustom) {
      const v = parseFloat(customDuration);
      return isNaN(v) || v <= 0 ? 0 : Math.round(v);
    }
    return durationMinutes;
  }

  function repeatLastLog() {
    if (!lastLog) return;
    selectedIssueKey = lastLog.issueKey;
    selectedSummary = lastLog.summary;
    durationMinutes = lastLog.durationMinutes;
    description = lastLog.description;
    useCustom = false;
    if (!PRESETS.some(p => p.mins === lastLog!.durationMinutes)) {
      useCustom = true;
      customDuration = String(lastLog.durationMinutes);
    }
  }

  function applyTemplate(tpl: Template) {
    selectedIssueKey = tpl.issueKey;
    selectedSummary = tpl.summary;
    durationMinutes = tpl.durationMinutes;
    description = tpl.description;
    useCustom = false;
    if (!PRESETS.some(p => p.mins === tpl.durationMinutes)) {
      useCustom = true;
      customDuration = String(tpl.durationMinutes);
    }
    showTemplates = false;
  }

  async function saveAsTemplate() {
    if (!selectedIssueKey) return;
    const tpl: Template = {
      id: genId(),
      name: `${selectedIssueKey} ${getEffectiveDurationMinutes()}m`,
      issueKey: selectedIssueKey,
      summary: selectedSummary,
      durationMinutes: getEffectiveDurationMinutes(),
      description,
    };
    templates = [...templates, tpl];
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("quicklog-templates.json");
    await store.set("templates", templates);
    await store.save();
  }

  async function deleteTemplate(id: string) {
    templates = templates.filter(t => t.id !== id);
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("quicklog-templates.json");
    await store.set("templates", templates);
    await store.save();
  }

  // --- Batch mode ---
  function addToBatch() {
    if (!selectedIssueKey || getEffectiveDurationMinutes() <= 0) return;
    batchEntries = [...batchEntries, {
      id: genId(),
      issueKey: selectedIssueKey,
      summary: selectedSummary,
      durationMinutes: getEffectiveDurationMinutes(),
      description,
      date: logDate,
    }];
    // Reset form for next entry
    selectedIssueKey = "";
    selectedSummary = "";
    description = "";
  }

  function removeBatchEntry(id: string) {
    batchEntries = batchEntries.filter(e => e.id !== id);
  }

  // --- Timer ---
  async function toggleTimer() {
    if (!credentials || !timerState) return;
    if (timerState.running) {
      timerState = await invoke<TimerState>("stop_timer");
      const mins = Math.max(1, Math.round(timerState.accumulated_seconds / 60));
      durationMinutes = mins;
      useCustom = true;
      customDuration = String(mins);
    } else {
      if (!selectedIssueKey) return;
      timerState = await invoke<TimerState>("start_timer", {
        issueKey: selectedIssueKey,
        summary: selectedSummary,
      });
    }
  }

  // --- Submit ---
  async function handleSubmit() {
    if (!credentials) return;

    const entries: LogEntry[] = batchMode && batchEntries.length > 0
      ? batchEntries
      : [{
          id: "single",
          issueKey: selectedIssueKey,
          summary: selectedSummary,
          durationMinutes: getEffectiveDurationMinutes(),
          description,
          date: logDate,
        }];

    if (entries.length === 0) return;
    if (entries.some(e => !e.issueKey || e.durationMinutes <= 0)) return;

    submitting = true;
    submitResult = null;
    let successCount = 0;

    try {
      for (const entry of entries) {
        const [y, m, d] = entry.date.split("-").map(Number);
        const started = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T09:00:00.000+0700`;

        await invoke("add_worklog", {
          baseUrl: credentials.baseUrl,
          email: credentials.email,
          apiToken: credentials.apiToken,
          isCloud: credentials.isCloud,
          issueKey: entry.issueKey,
          timeSpentSeconds: entry.durationMinutes * 60,
          started,
          comment: entry.description,
        });
        successCount++;

        // Update recent issues
        const updated = upsertRecentIssue(recentIssues, {
          issueKey: entry.issueKey,
          summary: entry.summary,
        });
        recentIssues = updated;
        await saveRecentIssues(credentials.email, updated);
      }

      // Save last log
      const lastEntry = entries[entries.length - 1];
      lastLog = {
        issueKey: lastEntry.issueKey,
        summary: lastEntry.summary,
        durationMinutes: lastEntry.durationMinutes,
        description: lastEntry.description,
      };
      const { load } = await import("@tauri-apps/plugin-store");
      const llStore = await load("quicklog-lastlog.json");
      await llStore.set("lastLog", lastLog);
      await llStore.save();

      // Reset timer if relevant
      if (timerState?.issue_key && entries.some(e => e.issueKey === timerState!.issue_key)) {
        await invoke("reset_timer");
        timerState = await invoke<TimerState>("get_timer_state");
      }

      if (batchMode) batchEntries = [];
      submitResult = { ok: true, msg: `✓ ${successCount} worklog berhasil di-log` };
      await loadTodaySummary();
      await loadWeeklySummary();

      setTimeout(() => { getCurrentWindow().close(); }, 1500);
    } catch (err) {
      submitResult = { ok: false, msg: `✗ ${successCount > 0 ? successCount + " logged, lalu " : ""}${err}` };
    }
    submitting = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") getCurrentWindow().close();
  }

  function formatDuration(mins: number): string {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  init();
</script>

<svelte:window onkeydown={onKeydown} />

<div class="quicklog-root">
  {#if loading}
    <div class="center-state">
      <div class="spinner"></div>
      <p>Memuat...</p>
    </div>
  {:else if !credentials}
    <div class="center-state">
      <p>⚠️ Belum login</p>
      <p class="hint">Buka aplikasi utama dan login terlebih dahulu.</p>
    </div>
  {:else}
    <!-- Today + Weekly bar -->
    <div class="today-bar">
      <div class="today-left">
        <span class="today-label">Hari ini:</span>
        <span class="today-hours">{todayHours}h</span>
        {#if timerState?.running}
          <span class="timer-badge">⏱</span>
        {/if}
      </div>
      <div class="weekly-progress">
        <span class="weekly-text">{weeklyHours}/{WEEKLY_TARGET}h</span>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {Math.min(100, (weeklyHours / WEEKLY_TARGET) * 100)}%"></div>
        </div>
      </div>
    </div>

    <!-- Action bar: Repeat + Templates + Batch toggle -->
    <div class="action-bar">
      {#if lastLog}
        <button type="button" class="action-chip" onclick={repeatLastLog} title="Repeat: {lastLog.issueKey} {lastLog.durationMinutes}m">
          ↻ Repeat
        </button>
      {/if}
      <button type="button" class="action-chip" class:active={showTemplates} onclick={() => showTemplates = !showTemplates}>
        📋 Template
      </button>
      <button type="button" class="action-chip" class:active={batchMode} onclick={() => batchMode = !batchMode}>
        📦 Batch
      </button>
      {#if selectedIssueKey && getEffectiveDurationMinutes() > 0}
        <button type="button" class="action-chip save-tpl" onclick={saveAsTemplate} title="Simpan sebagai template">
          💾
        </button>
      {/if}
    </div>

    <!-- Templates panel -->
    {#if showTemplates}
      <div class="templates-panel">
        {#if templates.length === 0}
          <p class="hint">Belum ada template.</p>
        {:else}
          {#each templates as tpl (tpl.id)}
            <div class="template-row">
              <button type="button" class="template-btn" onclick={() => applyTemplate(tpl)}>
                <span class="tpl-name">{tpl.issueKey}</span>
                <span class="tpl-detail">{formatDuration(tpl.durationMinutes)}{tpl.description ? ` — ${tpl.description}` : ""}</span>
              </button>
              <button type="button" class="tpl-del" onclick={() => deleteTemplate(tpl.id)}>×</button>
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- Issue Selection + Search -->
    <div class="section">
      <label class="section-label">Issue</label>
      <div class="search-wrapper">
        <input
          type="text"
          class="issue-input"
          placeholder="Ketik issue key atau cari..."
          bind:value={selectedIssueKey}
          oninput={() => { selectedSummary = ""; searchQuery = selectedIssueKey; onSearchInput(); }}
          onfocus={() => { if (searchResults.length > 0) showSearchResults = true; }}
          onblur={() => { setTimeout(() => showSearchResults = false, 200); }}
        />
        {#if showSearchResults && searchResults.length > 0}
          <div class="search-dropdown">
            {#each searchResults as r (r.key)}
              <button type="button" class="search-item" onmousedown={() => selectSearchResult(r)}>
                <span class="search-key">{r.key}</span>
                <span class="search-sum">{r.summary}</span>
              </button>
            {/each}
          </div>
        {:else if showSearchResults && searchLoading}
          <div class="search-dropdown"><p class="hint" style="padding:0.5rem">Mencari...</p></div>
        {/if}
      </div>
      {#if selectedSummary}
        <p class="issue-summary">{selectedSummary}</p>
      {/if}

      {#if recentIssues.length > 0}
        <div class="recent-list">
          <span class="recent-label">Recent:</span>
          {#each recentIssues.slice(0, 6) as issue (issue.issueKey)}
            <button type="button" class="recent-chip" class:active={selectedIssueKey === issue.issueKey} onclick={() => selectIssue(issue)} title={issue.summary}>
              {issue.issueKey}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Duration -->
    <div class="section">
      <label class="section-label">Durasi</label>
      <div class="preset-row">
        {#each PRESETS as preset (preset.mins)}
          <button type="button" class="preset-chip" class:active={!useCustom && durationMinutes === preset.mins} onclick={() => selectPreset(preset.mins)}>
            {preset.label}
          </button>
        {/each}
        <button type="button" class="preset-chip" class:active={useCustom} onclick={activateCustom}>⋯</button>
      </div>
      {#if useCustom}
        <div class="custom-duration">
          <input type="number" min="1" max="1440" step="1" placeholder="Menit" bind:value={customDuration} />
          <span class="duration-hint">menit ({formatDuration(getEffectiveDurationMinutes())})</span>
        </div>
      {/if}
    </div>

    <!-- Date -->
    <div class="section row">
      <label class="section-label">Tanggal</label>
      <input type="date" class="date-input" bind:value={logDate} />
    </div>

    <!-- Description -->
    <div class="section">
      <label class="section-label">Deskripsi <span class="optional">(opsional)</span></label>
      <input type="text" class="desc-input" placeholder="Apa yang dikerjakan?" maxlength="500" bind:value={description} />
    </div>

    <!-- Batch entries -->
    {#if batchMode}
      <div class="section">
        <div class="batch-header">
          <span class="section-label">Batch ({batchEntries.length})</span>
          <button type="button" class="add-batch-btn" onclick={addToBatch} disabled={!selectedIssueKey || getEffectiveDurationMinutes() <= 0}>
            + Tambah
          </button>
        </div>
        {#if batchEntries.length > 0}
          <div class="batch-list">
            {#each batchEntries as entry (entry.id)}
              <div class="batch-item">
                <span class="batch-key">{entry.issueKey}</span>
                <span class="batch-dur">{formatDuration(entry.durationMinutes)}</span>
                <span class="batch-date">{entry.date}</span>
                <button type="button" class="batch-del" onclick={() => removeBatchEntry(entry.id)}>×</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Timer + Submit footer -->
    <div class="footer">
      <div class="timer-row">
        <button type="button" class="timer-btn" class:running={timerState?.running} onclick={toggleTimer} disabled={!selectedIssueKey && !timerState?.running}>
          {timerState?.running ? "⏹ Stop" : "⏱ Timer"}
        </button>
        {#if timerState?.running}
          <span class="timer-hint">Berjalan...</span>
        {:else if timerState && timerState.accumulated_seconds > 0}
          <span class="timer-hint">{formatDuration(Math.round(timerState.accumulated_seconds / 60))}</span>
        {/if}
      </div>

      {#if submitResult}
        <p class="result" class:success={submitResult.ok} class:error={!submitResult.ok}>{submitResult.msg}</p>
      {/if}

      <button type="button" class="submit-btn" disabled={submitting || (batchMode ? batchEntries.length === 0 : !selectedIssueKey || getEffectiveDurationMinutes() <= 0)} onclick={handleSubmit}>
        {#if submitting}Logging...{:else}{batchMode ? `Log ${batchEntries.length} Entry` : "Log Worklog"}{/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .quicklog-root {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    gap: 0.5rem;
    height: 100vh;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f172a;
    color: #f1f5f9;
  }

  .center-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .hint { font-size: 0.75rem; color: rgba(255, 255, 255, 0.45); margin: 0; }

  .spinner {
    width: 1.5rem; height: 1.5rem;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: #818cf8;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Today + Weekly bar */
  .today-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.4rem 0.6rem; border-radius: 0.5rem;
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid rgba(99, 102, 241, 0.2);
    font-size: 0.75rem;
  }
  .today-left { display: flex; align-items: center; gap: 0.375rem; }
  .today-label { color: rgba(255, 255, 255, 0.55); }
  .today-hours { font-weight: 600; color: #a5b4fc; }
  .timer-badge { color: #86efac; animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .weekly-progress { display: flex; align-items: center; gap: 0.375rem; }
  .weekly-text { font-size: 0.6875rem; color: rgba(255, 255, 255, 0.55); }
  .progress-bar {
    width: 3.5rem; height: 0.375rem; border-radius: 1rem;
    background: rgba(255, 255, 255, 0.1); overflow: hidden;
  }
  .progress-fill {
    height: 100%; border-radius: 1rem;
    background: linear-gradient(90deg, #6366f1, #22c55e);
    transition: width 300ms;
  }

  /* Action bar */
  .action-bar { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .action-chip {
    padding: 0.25rem 0.5rem; border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: #cbd5e1; font-size: 0.6875rem; cursor: pointer;
    transition: all 120ms;
  }
  .action-chip:hover { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
  .action-chip.active { background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #a5b4fc; }
  .save-tpl { border-color: rgba(34, 197, 94, 0.3); }
  .save-tpl:hover { background: rgba(34, 197, 94, 0.12); }

  /* Templates */
  .templates-panel {
    display: flex; flex-direction: column; gap: 0.25rem;
    padding: 0.4rem; border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    max-height: 6rem; overflow-y: auto;
  }
  .template-row { display: flex; align-items: center; gap: 0.25rem; }
  .template-btn {
    flex: 1; display: flex; gap: 0.375rem; align-items: center;
    padding: 0.25rem 0.4rem; border-radius: 0.25rem;
    border: none; background: rgba(99, 102, 241, 0.08);
    color: #e2e8f0; font-size: 0.6875rem; cursor: pointer;
    text-align: left; transition: background 120ms;
  }
  .template-btn:hover { background: rgba(99, 102, 241, 0.18); }
  .tpl-name { font-weight: 600; color: #a5b4fc; font-family: monospace; }
  .tpl-detail { color: rgba(255, 255, 255, 0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tpl-del {
    width: 1.25rem; height: 1.25rem; display: flex; align-items: center; justify-content: center;
    border: none; border-radius: 0.25rem; background: rgba(239, 68, 68, 0.1);
    color: #fca5a5; font-size: 0.75rem; cursor: pointer;
  }
  .tpl-del:hover { background: rgba(239, 68, 68, 0.2); }

  /* Sections */
  .section { display: flex; flex-direction: column; gap: 0.25rem; }
  .section.row { flex-direction: row; align-items: center; gap: 0.5rem; }
  .section-label {
    font-size: 0.6875rem; font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .optional { font-weight: 400; text-transform: none; color: rgba(255, 255, 255, 0.35); }

  /* Inputs */
  .issue-input, .date-input, .desc-input {
    padding: 0.4rem 0.6rem; border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #f1f5f9; font-size: 0.8125rem; outline: none;
    transition: border-color 150ms, box-shadow 150ms; color-scheme: dark;
    width: 100%; box-sizing: border-box;
  }
  .issue-input:focus, .date-input:focus, .desc-input:focus {
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
  }
  .date-input { width: auto; flex: 1; }
  .issue-summary { font-size: 0.6875rem; color: rgba(255, 255, 255, 0.45); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Search dropdown */
  .search-wrapper { position: relative; }
  .search-dropdown {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 20;
    background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.375rem; max-height: 10rem; overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .search-item {
    display: flex; gap: 0.375rem; align-items: center;
    width: 100%; padding: 0.375rem 0.5rem;
    border: none; background: transparent; color: #e2e8f0;
    font-size: 0.75rem; cursor: pointer; text-align: left;
  }
  .search-item:hover { background: rgba(99, 102, 241, 0.15); }
  .search-key { font-weight: 600; color: #a5b4fc; font-family: monospace; white-space: nowrap; }
  .search-sum { color: rgba(255, 255, 255, 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Recent */
  .recent-list { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
  .recent-label { font-size: 0.625rem; color: rgba(255, 255, 255, 0.4); }
  .recent-chip {
    padding: 0.2rem 0.4rem; border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: #94a3b8; font-size: 0.625rem; font-family: monospace;
    cursor: pointer; transition: all 120ms;
  }
  .recent-chip:hover { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
  .recent-chip.active { background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #a5b4fc; }

  /* Duration presets */
  .preset-row { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .preset-chip {
    padding: 0.3rem 0.5rem; border-radius: 0.3rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: #cbd5e1; font-size: 0.75rem; font-weight: 500;
    cursor: pointer; transition: all 120ms;
  }
  .preset-chip:hover { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
  .preset-chip.active { background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.5); color: #a5b4fc; font-weight: 600; }

  .custom-duration { display: flex; align-items: center; gap: 0.4rem; }
  .custom-duration input {
    width: 4.5rem; padding: 0.3rem 0.5rem; border-radius: 0.3rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #f1f5f9; font-size: 0.8125rem; outline: none; color-scheme: dark;
  }
  .custom-duration input:focus { border-color: rgba(99, 102, 241, 0.5); box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12); }
  .duration-hint { font-size: 0.6875rem; color: rgba(255, 255, 255, 0.4); }

  /* Batch */
  .batch-header { display: flex; align-items: center; justify-content: space-between; }
  .add-batch-btn {
    padding: 0.2rem 0.5rem; border-radius: 0.25rem;
    border: 1px dashed rgba(99, 102, 241, 0.4);
    background: transparent; color: #a5b4fc;
    font-size: 0.6875rem; cursor: pointer;
  }
  .add-batch-btn:hover { background: rgba(99, 102, 241, 0.1); }
  .add-batch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .batch-list { display: flex; flex-direction: column; gap: 0.2rem; }
  .batch-item {
    display: flex; align-items: center; gap: 0.375rem;
    padding: 0.25rem 0.4rem; border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.6875rem;
  }
  .batch-key { font-weight: 600; color: #a5b4fc; font-family: monospace; }
  .batch-dur { color: #e2e8f0; }
  .batch-date { color: rgba(255, 255, 255, 0.4); margin-left: auto; }
  .batch-del {
    width: 1rem; height: 1rem; display: flex; align-items: center; justify-content: center;
    border: none; border-radius: 0.2rem; background: rgba(239, 68, 68, 0.1);
    color: #fca5a5; font-size: 0.7rem; cursor: pointer;
  }
  .batch-del:hover { background: rgba(239, 68, 68, 0.2); }

  /* Footer */
  .footer { margin-top: auto; display: flex; flex-direction: column; gap: 0.4rem; }
  .timer-row { display: flex; align-items: center; gap: 0.5rem; }
  .timer-btn {
    padding: 0.3rem 0.6rem; border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: #e2e8f0; font-size: 0.75rem; cursor: pointer; transition: all 120ms;
  }
  .timer-btn:hover:not(:disabled) { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
  .timer-btn.running { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.35); color: #fca5a5; }
  .timer-btn.running:hover { background: rgba(239, 68, 68, 0.2); }
  .timer-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .timer-hint { font-size: 0.6875rem; color: rgba(255, 255, 255, 0.45); }

  .result {
    font-size: 0.75rem; padding: 0.35rem 0.5rem; border-radius: 0.25rem; margin: 0;
  }
  .result.success { background: rgba(34, 197, 94, 0.12); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.25); }
  .result.error { background: rgba(239, 68, 68, 0.12); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.25); }

  .submit-btn {
    width: 100%; padding: 0.5rem 0.75rem; border-radius: 0.5rem;
    border: none; background: #6366f1; color: white;
    font-size: 0.875rem; font-weight: 600; cursor: pointer;
    transition: background 150ms;
  }
  .submit-btn:hover:not(:disabled) { background: #4f46e5; }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
