<script lang="ts">
  /**
   * SettingsDrawer
   *
   * Slide-in drawer panel from the right edge of the viewport that hosts the
   * three workspace settings sections: Jira Connection, Reminder, and Target
   * Hours. Replaces the legacy Settings page.
   *
   * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10,
   *            4.11, 11.2, 11.5, 13.2, 14.6
   *
   * Animation
   * ---------
   * Total transition is 250 ms (within the R4.10 150–350 ms window). The
   * panel uses `transform: translateX(100%) -> translateX(0)` and the
   * backdrop uses `opacity` (background-color rgba alpha). When the OS
   * reports `prefers-reduced-motion: reduce`, the existing `.drawer-panel`
   * rule in `app.css` cancels the transform and any decorative
   * transitions (R4.11, R11.5).
   *
   * Focus trap (R4.9, R13.2)
   * -----------------------
   * On open we capture the previously-focused element, scan the panel for
   * focusable descendants, and redirect Tab / Shift+Tab to wrap between the
   * first and last items. Focus is restored to the originally-focused
   * element when the drawer closes.
   *
   * Outside-click and Escape (R4.8) call the `onClose` prop. Persistence
   * uses the existing `settings.json` Tauri store via `saveCredentials` /
   * `saveWorkspaceSettings` (R14.6).
   */

  import { tick, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    type WorkspaceSettings,
    validateWorkspaceSettings,
    saveWorkspaceSettings,
  } from "../stores/settingsStore";
  import {
    type Credentials,
    saveCredentials,
  } from "../stores/authStore";
  import {
    type AutoScheduleConfig,
    type AutoScheduleActivity,
    DEFAULT_AUTO_SCHEDULE_CONFIG,
    CATCH_UP_MAX_LIMIT,
    saveAutoScheduleConfig,
    emptyActivity,
  } from "../stores/autoScheduleStore";
  import {
    isAutostartEnabled,
    setAutostart,
  } from "../stores/autostartStore";
  import { checkForUpdate, currentVersion } from "../stores/updaterStore";
  import { requestUpdateCheck } from "../stores/updateSignal.svelte";

  interface Props {
    open: boolean;
    initialSettings: WorkspaceSettings;
    initialCredentials: Credentials;
    initialIsCloud: boolean;
    initialAutoSchedule: AutoScheduleConfig;
    onClose: () => void;
    onSettingsSaved: (next: WorkspaceSettings) => void;
    onCredentialsSaved: (next: Credentials, isCloud: boolean) => void;
    onAutoScheduleSaved: (next: AutoScheduleConfig) => void;
  }

  let {
    open,
    initialSettings,
    initialCredentials,
    initialIsCloud,
    initialAutoSchedule,
    onClose,
    onSettingsSaved,
    onCredentialsSaved,
    onAutoScheduleSaved,
  }: Props = $props();

  // Day-of-week labels (0=Minggu … 6=Sabtu), Indonesian short form.
  const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

  // --- Animation gating -----------------------------------------------------
  // `mounted` controls DOM presence so the closing animation can play before
  // unmount. `slidIn` toggles the translateX(0) class one frame after mount
  // so the slide animates from translateX(100%).
  let mounted = $state(false);
  let slidIn = $state(false);

  // 250 ms total animation, within the R4.10 150–350 ms window.
  const ANIMATION_DURATION_MS = 250;

  // --- Form state mirrored from props --------------------------------------
  // Initialised to neutral defaults; synced from props inside the `open`
  // $effect so re-opening the drawer always reflects the current persisted
  // values. Reading the props directly here would only capture their value
  // at component construction, which is not what we want.
  let baseUrl = $state("");
  let email = $state("");
  let apiToken = $state("");
  let isCloud = $state(true);

  let reminderEnabled = $state(false);
  let reminderHour = $state<number>(9);
  let targetHours = $state<number>(8);

  // Inline validation errors for the Reminder + Target Hours sections.
  let settingsErrors = $state<{ reminderHour?: string; targetHours?: string }>({});

  // --- Auto-schedule form state (mirrored from props on open) --------------
  let autoEnabled = $state(false);
  let autoActivities = $state<AutoScheduleActivity[]>([]);
  let autoDays = $state<number[]>([...DEFAULT_AUTO_SCHEDULE_CONFIG.daysOfWeek]);
  let autoSkipHolidays = $state(true);
  let autoCatchUp = $state(true);
  let autoCatchUpMaxDays = $state<number>(7);
  // Level 2: run at login + background tray. Reflects the OS autostart entry.
  let autoStartOnLogin = $state(false);
  let autoStartError = $state<string | null>(null);

  // Connection-test status banner state, mirrors the legacy Settings page.
  let connStatus = $state<"idle" | "loading" | "success" | "error">("idle");
  let connMessage = $state("");

  // --- Focus trap state ----------------------------------------------------
  let panelEl: HTMLDivElement | undefined = $state();
  let previouslyFocusedEl: HTMLElement | null = null;

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable(): HTMLElement[] {
    if (!panelEl) return [];
    return Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function trapTab(event: KeyboardEvent) {
    const items = getFocusable();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !panelEl?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !panelEl?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function onPanelKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      trapTab(event);
    }
  }

  // --- Open / close lifecycle ----------------------------------------------
  // When `open` toggles, we orchestrate mount + slide-in (open) or slide-out
  // + unmount (close). Form state is also re-synced from props on open so a
  // re-opened drawer reflects the current values, even if the user closed
  // without saving.
  $effect(() => {
    if (open) {
      // Re-sync form state from props each time the drawer opens, so the
      // panel reflects the current persisted values when re-opened.
      untrack(() => {
        baseUrl = initialCredentials.baseUrl;
        email = initialCredentials.email;
        apiToken = initialCredentials.apiToken;
        isCloud = initialIsCloud;
        reminderEnabled = initialSettings.reminderEnabled;
        reminderHour = initialSettings.reminderHour;
        targetHours = initialSettings.targetHours;
        autoEnabled = initialAutoSchedule.enabled;
        autoActivities = initialAutoSchedule.activities.map((a) => ({ ...a }));
        autoDays = [...initialAutoSchedule.daysOfWeek];
        autoSkipHolidays = initialAutoSchedule.skipHolidays;
        autoCatchUp = initialAutoSchedule.catchUp;
        autoCatchUpMaxDays = initialAutoSchedule.catchUpMaxDays;
        autoStartError = null;
        settingsErrors = {};
        connStatus = "idle";
        connMessage = "";
      });

      // Reflect the actual OS autostart entry (async; no-op off-Tauri).
      void (async () => {
        autoStartOnLogin = await isAutostartEnabled();
      })();

      previouslyFocusedEl = (document.activeElement as HTMLElement | null) ?? null;
      mounted = true;

      // Move focus inside the panel and flip the slide-in class on the next
      // frame so the transform transition is observable.
      void (async () => {
        await tick();
        // Two RAFs guarantees the browser has applied the initial
        // translateX(100%) before we toggle to translateX(0).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            slidIn = true;
          });
        });
        const items = getFocusable();
        if (items.length > 0) {
          items[0].focus();
        } else {
          panelEl?.focus();
        }
      })();
    } else if (mounted) {
      // Animate out, then unmount after the transition completes.
      slidIn = false;
      const restore = previouslyFocusedEl;
      previouslyFocusedEl = null;
      const timer = window.setTimeout(() => {
        mounted = false;
        // Restore focus to whatever had it before the drawer opened.
        if (restore && typeof restore.focus === "function") {
          try {
            restore.focus();
          } catch {
            /* element may have been removed; ignore */
          }
        }
      }, ANIMATION_DURATION_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
  });

  // --- Backdrop click ------------------------------------------------------
  function onBackdropMouseDown(event: MouseEvent) {
    // Only treat clicks that started on the backdrop itself as "outside"
    // (R4.8). Clicks that bubble up from inside the panel are ignored.
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  // --- Connection test + credentials persistence (R4.2) -------------------
  async function testConnectionAndSave() {
    connStatus = "loading";
    connMessage = "Testing...";
    try {
      const name = await invoke<string>("test_connection", {
        baseUrl,
        email,
        apiToken,
        isCloud,
      });
      const nextCreds: Credentials = { baseUrl, email, apiToken };
      await saveCredentials(nextCreds);
      // Persist `isCloud` alongside the credentials per R4.2 / R14.6.
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      await store.set("isCloud", isCloud);
      await store.save();

      connStatus = "success";
      connMessage = `Connected as: ${name}`;
      onCredentialsSaved(nextCreds, isCloud);
    } catch (err) {
      connStatus = "error";
      connMessage = `Failed: ${err}`;
    }
  }

  // --- Workspace settings persistence (R4.5–4.7, R14.6) -------------------
  async function saveWorkspacePrefs() {
    const next: WorkspaceSettings = {
      reminderEnabled,
      reminderHour,
      targetHours,
    };
    const result = validateWorkspaceSettings(next);
    if (!result.valid) {
      // Inline errors only; do NOT persist (R4.6).
      settingsErrors = { ...result.errors };
      return;
    }
    settingsErrors = {};
    await saveWorkspaceSettings(next);
    onSettingsSaved(next);
  }

  // --- Auto-schedule helpers + persistence ---------------------------------

  function toggleAutoDay(day: number): void {
    autoDays = autoDays.includes(day)
      ? autoDays.filter((d) => d !== day)
      : [...autoDays, day].sort((a, b) => a - b);
  }

  function addAutoActivity(): void {
    autoActivities = [...autoActivities, emptyActivity()];
  }

  function removeAutoActivity(id: string): void {
    autoActivities = autoActivities.filter((a) => a.id !== id);
  }

  /** Persist the auto-schedule config and notify the parent. Activities with
   *  an empty issue key or non-positive hours are dropped on save. */
  async function persistAutoSchedule(): Promise<void> {
    const clampedMax = Math.min(
      Math.max(1, Math.round(Number(autoCatchUpMaxDays) || 1)),
      CATCH_UP_MAX_LIMIT,
    );
    const next: AutoScheduleConfig = {
      enabled: autoEnabled,
      activities: autoActivities
        .map((a) => ({
          ...a,
          issueKey: a.issueKey.trim(),
          hours: Number(a.hours) || 0,
          startDate: a.startDate?.trim() || undefined,
          endDate: a.endDate?.trim() || undefined,
        }))
        .filter((a) => a.issueKey.length > 0 && a.hours > 0),
      daysOfWeek: [...autoDays].sort((a, b) => a - b),
      skipHolidays: autoSkipHolidays,
      catchUp: autoCatchUp,
      catchUpMaxDays: clampedMax,
    };
    await saveAutoScheduleConfig(next);
    onAutoScheduleSaved(next);

    // Apply the OS autostart entry to match the toggle. Surfaced inline on
    // failure but never blocks saving the rest of the config.
    try {
      autoStartError = null;
      await setAutostart(autoStartOnLogin);
    } catch (err) {
      autoStartError = `Gagal mengubah autostart: ${err}`;
    }
  }

  /** Footer "Save": persist auto-schedule (always) + workspace prefs
   *  (validated). Credentials use their own Test & Save button. */
  async function saveAll(): Promise<void> {
    await persistAutoSchedule();
    await saveWorkspacePrefs();
  }

  // --- Derived submit-disabled state for the Test & Save button ----------
  let canTestConnection = $derived(
    connStatus !== "loading" &&
      baseUrl.trim().length > 0 &&
      email.trim().length > 0 &&
      apiToken.trim().length > 0
  );

  // --- Tentang aplikasi ---------------------------------------------------

  /** Identitas aplikasi. Ubah di sini kalau nama/kepemilikan berganti —
   *  nilai yang sama juga ada di `package.json` dan `tauri.conf.json`
   *  (dipakai properti file Windows dan Info.plist macOS). */
  const APP_AUTHOR = "wembyjuniarrochman";
  const APP_REPO = "https://github.com/wembyjuniarrochman/jira-logwork";
  const APP_COPYRIGHT = "© 2026 wembyjuniarrochman";

  // Versi dibaca dari runtime Tauri, bukan dari konstanta, supaya tidak
  // pernah melenceng dari versi biner yang sebenarnya berjalan.
  let appVersion = $state<string>("");
  let updateChecking = $state<boolean>(false);
  let updateStatus = $state<string | null>(null);

  $effect(() => {
    void (async () => {
      appVersion = await currentVersion();
    })();
  });

  /** Buka tautan di browser sistem, bukan di dalam webview aplikasi. */
  async function openExternal(event: MouseEvent, url: string): Promise<void> {
    event.preventDefault();
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      // Preview di browser / tes: jatuh ke window.open agar tautan tetap
      // berfungsi di luar runtime desktop. Pola yang sama dipakai
      // CalendarGrid saat membuka issue Jira.
      window.open(url, "_blank", "noopener");
    }
  }

  /**
   * Cek pembaruan atas permintaan user. Alur unduh + pasang dimiliki
   * `UpdateBanner`; di sini kita hanya melaporkan hasilnya dan — bila ada
   * versi baru — memicu banner tersebut lewat `requestUpdateCheck`.
   */
  async function handleCheckUpdate(): Promise<void> {
    updateChecking = true;
    updateStatus = null;
    try {
      const found = await checkForUpdate();
      if (found) {
        updateStatus = `Versi ${found.version} tersedia — lihat banner di kanan bawah.`;
        requestUpdateCheck();
      } else {
        updateStatus = "Sudah versi terbaru.";
      }
    } finally {
      updateChecking = false;
    }
  }
</script>

{#if mounted}
  <!-- Backdrop: clicking outside the panel closes the drawer (R4.8). -->
  <div
    class="drawer-backdrop"
    class:visible={slidIn}
    role="presentation"
    onmousedown={onBackdropMouseDown}
  >
    <!--
      The slide-in panel. The .drawer-panel class is intentionally used so
      the existing prefers-reduced-motion rule in app.css disables transforms
      and transitions when the user opts into reduced motion (R4.11, R11.5).
    -->
    <div
      class="drawer-panel glass glass-overlay"
      class:open={slidIn}
      role="dialog"
      aria-modal="true"
      aria-label="Workspace settings"
      tabindex="-1"
      bind:this={panelEl}
      onkeydown={onPanelKeyDown}
    >
      <header class="drawer-header">
        <h2 class="drawer-title">Settings</h2>
        <button
          type="button"
          class="close-btn"
          aria-label="Close settings"
          onclick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="drawer-body">
        <!-- ============================================================ -->
        <!-- Section 1 — Jira Connection (R4.1, R4.2)                     -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-jira-connection">
          <h3 id="section-jira-connection" class="section-title">Jira Connection</h3>

          <div class="form-field">
            <span class="field-label">Deployment</span>
            <div class="radio-row" role="radiogroup" aria-label="Jira deployment">
              <label class="radio-label">
                <input
                  type="radio"
                  name="settings-deployment"
                  bind:group={isCloud}
                  value={true}
                />
                <span>Cloud</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  name="settings-deployment"
                  bind:group={isCloud}
                  value={false}
                />
                <span>Server</span>
              </label>
            </div>
          </div>

          <div class="form-field">
            <label for="settings-base-url">Jira URL</label>
            <input
              id="settings-base-url"
              type="url"
              bind:value={baseUrl}
              placeholder={isCloud
                ? "https://company.atlassian.net"
                : "https://jira.company.com"}
              autocomplete="url"
            />
          </div>

          <div class="form-field">
            <label for="settings-email">Email</label>
            <input
              id="settings-email"
              type="email"
              bind:value={email}
              placeholder="user@company.com"
              autocomplete="email"
            />
          </div>

          <div class="form-field">
            <label for="settings-api-token">API Token</label>
            <input
              id="settings-api-token"
              type="password"
              bind:value={apiToken}
              placeholder="Enter your API token"
              autocomplete="current-password"
            />
          </div>

          {#if connStatus === "success"}
            <div
              class="status-banner status-success"
              role="status"
              aria-live="polite"
            >
              {connMessage}
            </div>
          {:else if connStatus === "error"}
            <div
              class="status-banner status-error"
              role="alert"
              aria-live="assertive"
            >
              {connMessage}
            </div>
          {/if}

          <button
            type="button"
            class="primary-btn"
            disabled={!canTestConnection}
            onclick={testConnectionAndSave}
          >
            {connStatus === "loading" ? "Testing..." : "Test Connection & Save"}
          </button>
        </section>

        <!-- ============================================================ -->
        <!-- Section 2 — Reminder (R4.3)                                   -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-reminder">
          <h3 id="section-reminder" class="section-title">Reminder</h3>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={reminderEnabled} />
            <span>Enable daily reminder</span>
          </label>

          <div class="form-field">
            <label for="settings-reminder-hour">Reminder hour (24h)</label>
            <input
              id="settings-reminder-hour"
              type="number"
              min="8"
              max="22"
              step="1"
              bind:value={reminderHour}
              aria-invalid={settingsErrors.reminderHour ? "true" : undefined}
              aria-describedby={settingsErrors.reminderHour
                ? "settings-reminder-hour-error"
                : undefined}
            />
            {#if settingsErrors.reminderHour}
              <p
                id="settings-reminder-hour-error"
                class="field-error"
                role="alert"
              >
                {settingsErrors.reminderHour}
              </p>
            {/if}
          </div>
        </section>

        <!-- ============================================================ -->
        <!-- Section 3 — Target Hours (R4.4)                               -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-target-hours">
          <h3 id="section-target-hours" class="section-title">Target Hours</h3>

          <div class="form-field">
            <label for="settings-target-hours">Daily target (hours)</label>
            <input
              id="settings-target-hours"
              type="number"
              min="1"
              max="12"
              step="0.5"
              bind:value={targetHours}
              aria-invalid={settingsErrors.targetHours ? "true" : undefined}
              aria-describedby={settingsErrors.targetHours
                ? "settings-target-hours-error"
                : undefined}
            />
            {#if settingsErrors.targetHours}
              <p
                id="settings-target-hours-error"
                class="field-error"
                role="alert"
              >
                {settingsErrors.targetHours}
              </p>
            {/if}
          </div>
        </section>

        <!-- ============================================================ -->
        <!-- Section 4 — Penjadwalan Otomatis (draf harian utk direview)  -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-auto-schedule">
          <h3 id="section-auto-schedule" class="section-title">
            Penjadwalan Otomatis
          </h3>
          <p class="section-hint">
            Menyiapkan draf kegiatan berulang pada hari kerja terpilih. Draf
            tampil di kalender untuk kamu periksa &amp; ubah dulu, lalu
            dikirim ke Jira lewat tombol "Submit changes" — tidak ada yang
            terkirim otomatis. Berjalan saat aplikasi dibuka.
          </p>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={autoEnabled} />
            <span>Aktifkan penjadwalan otomatis</span>
          </label>

          <fieldset class="auto-fieldset" disabled={!autoEnabled}>
            <!-- Days of week -->
            <div class="form-field">
              <span class="field-label">Hari berlaku</span>
              <div class="day-toggle-row" role="group" aria-label="Hari berlaku">
                {#each DAY_LABELS as label, day (day)}
                  <button
                    type="button"
                    class="day-toggle"
                    class:active={autoDays.includes(day)}
                    aria-pressed={autoDays.includes(day)}
                    onclick={() => toggleAutoDay(day)}
                  >
                    {label}
                  </button>
                {/each}
              </div>
            </div>

            <label class="checkbox-label">
              <input type="checkbox" bind:checked={autoSkipHolidays} />
              <span>Lewati hari libur nasional</span>
            </label>

            <label class="checkbox-label">
              <input type="checkbox" bind:checked={autoCatchUp} />
              <span>Isi juga hari kerja yang terlewat</span>
            </label>

            {#if autoCatchUp}
              <div class="form-field">
                <label for="auto-catchup-max">Maksimal hari ke belakang</label>
                <input
                  id="auto-catchup-max"
                  type="number"
                  min="1"
                  max={CATCH_UP_MAX_LIMIT}
                  step="1"
                  bind:value={autoCatchUpMaxDays}
                />
              </div>
            {/if}

            <div class="form-field">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={autoStartOnLogin} />
                <span>Jalankan saat login &amp; tetap aktif di background</span>
              </label>
              <p class="section-hint">
                Aplikasi dibuka otomatis (tersembunyi di tray) saat kamu login,
                sehingga penjadwalan berjalan tanpa perlu dibuka manual. Menutup
                jendela akan menyembunyikan ke tray — keluar penuh lewat menu
                tray “Keluar”.
              </p>
              {#if autoStartError}
                <p class="field-error" role="alert">{autoStartError}</p>
              {/if}
            </div>

            <!-- Activities -->
            <div class="form-field">
              <span class="field-label">Kegiatan harian</span>
              {#if autoActivities.length === 0}
                <p class="section-hint">
                  Belum ada kegiatan. Tambahkan minimal satu.
                </p>
              {/if}

              <div class="activity-list">
                {#each autoActivities as activity (activity.id)}
                  <div class="activity-card">
                    <div class="activity-grid">
                      <label class="mini-field mini-issue">
                        <span>Issue key</span>
                        <input
                          type="text"
                          placeholder="mis. PROJ-123"
                          autocomplete="off"
                          spellcheck="false"
                          bind:value={activity.issueKey}
                        />
                      </label>
                      <label class="mini-field mini-hours">
                        <span>Jam</span>
                        <input
                          type="number"
                          min="0.25"
                          max="24"
                          step="0.25"
                          bind:value={activity.hours}
                        />
                      </label>
                      <label class="mini-field mini-time">
                        <span>Mulai</span>
                        <input type="time" bind:value={activity.startTime} />
                      </label>
                    </div>
                    <div class="activity-date-range">
                      <label class="mini-field mini-date">
                        <span>Berlaku dari</span>
                        <input
                          type="date"
                          bind:value={activity.startDate}
                        />
                      </label>
                      <label class="mini-field mini-date">
                        <span>Sampai</span>
                        <input
                          type="date"
                          bind:value={activity.endDate}
                        />
                      </label>
                    </div>
                    <label class="mini-field">
                      <span>Deskripsi (opsional)</span>
                      <input
                        type="text"
                        placeholder="Apa yang dikerjakan?"
                        maxlength="500"
                        bind:value={activity.description}
                      />
                    </label>
                    <button
                      type="button"
                      class="activity-remove"
                      aria-label="Hapus kegiatan"
                      onclick={() => removeAutoActivity(activity.id)}
                    >
                      Hapus
                    </button>
                  </div>
                {/each}
              </div>

              <button
                type="button"
                class="add-activity-btn"
                onclick={addAutoActivity}
              >
                + Tambah kegiatan
              </button>
            </div>
          </fieldset>
        </section>

        <!-- ============================================================ -->
        <!-- Section 5 — Tentang aplikasi                                 -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-about">
          <h3 id="section-about" class="section-title">Tentang</h3>

          <dl class="about-list">
            <dt>Aplikasi</dt>
            <dd>JIRA Logwork</dd>

            <dt>Versi</dt>
            <dd>
              {#if appVersion}
                <span class="about-version">{appVersion}</span>
              {:else}
                <span class="about-muted">—</span>
              {/if}
            </dd>

            <dt>Pembuat</dt>
            <dd>{APP_AUTHOR}</dd>

            <dt>Kode sumber</dt>
            <dd>
              <a
                class="about-link"
                href={APP_REPO}
                onclick={(e) => openExternal(e, APP_REPO)}
              >
                {APP_REPO.replace("https://github.com/", "")}
              </a>
            </dd>
          </dl>

          <p class="about-copyright">{APP_COPYRIGHT}</p>

          <div class="about-update">
            <button
              type="button"
              class="secondary-btn about-check-btn"
              onclick={handleCheckUpdate}
              disabled={updateChecking}
            >
              {updateChecking ? "Mengecek…" : "Cek pembaruan"}
            </button>
            {#if updateStatus}
              <span class="about-update-status">{updateStatus}</span>
            {/if}
          </div>
          <p class="section-hint">
            Pembaruan juga dicek otomatis setiap kali aplikasi dibuka.
          </p>
        </section>
      </div>

      <footer class="drawer-footer">
        <button type="button" class="secondary-btn" onclick={onClose}>
          Cancel
        </button>
        <button type="button" class="primary-btn" onclick={saveAll}>
          Save
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  /* ----------------------------------------------------------------------
   * Backdrop + panel layout
   *
   * The backdrop covers the viewport and fades over 250 ms. The panel is
   * pinned to the right edge and slides 100% of its width into view via
   * `transform: translateX(...)`. The `.drawer-panel` class is also matched
   * by the prefers-reduced-motion rule in app.css, which cancels the
   * transform/transition under reduced-motion.
   * ---------------------------------------------------------------------- */

  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background-color: rgba(15, 23, 42, 0);
    transition: background-color 250ms cubic-bezier(0.22, 1, 0.36, 1);
    display: flex;
    justify-content: flex-end;
  }

  .drawer-backdrop.visible {
    background-color: rgba(15, 23, 42, 0.55);
  }

  .drawer-panel {
    position: relative;
    width: min(28rem, 100%);
    max-width: 100vw;
    height: 100%;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 250ms cubic-bezier(0.22, 1, 0.36, 1);
    /* The .glass utility supplies bg/blur/border/shadow/radius; we pin the
     * panel to the right edge so only the inner corners are rounded. */
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    outline: none;
  }

  .drawer-panel.open {
    transform: translateX(0);
  }

  /* ----------------------------------------------------------------------
   * Header / body / footer
   * ---------------------------------------------------------------------- */

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--glass-border);
  }

  .drawer-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: -0.01em;
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
  }

  .close-btn svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .close-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.45);
  }

  .drawer-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .drawer-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.625rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--glass-border);
  }

  /* ----------------------------------------------------------------------
   * Sections
   * ---------------------------------------------------------------------- */

  .drawer-section {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  /* --- Tentang aplikasi ------------------------------------------------ */

  .about-list {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.375rem 1rem;
    margin: 0;
    font-size: 0.8125rem;
  }

  .about-list dt {
    color: rgba(255, 255, 255, 0.5);
  }

  .about-list dd {
    margin: 0;
    color: #e2e8f0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .about-version {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .about-muted {
    color: rgba(255, 255, 255, 0.4);
  }

  .about-link {
    color: #a5b4fc;
    text-decoration: none;
  }

  .about-link:hover {
    text-decoration: underline;
  }

  .about-copyright {
    margin: 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .about-update {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .about-check-btn {
    flex-shrink: 0;
  }

  .about-update-status {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .section-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }

  /* ----------------------------------------------------------------------
   * Form fields — visual language matches CredentialForm.svelte (glass
   * inputs, label-above pattern).
   * ---------------------------------------------------------------------- */

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-field label,
  .field-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    letter-spacing: 0.025em;
  }

  .form-field input[type="url"],
  .form-field input[type="email"],
  .form-field input[type="password"],
  .form-field input[type="number"] {
    width: 100%;
    padding: 0.625rem 0.875rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font-size: 0.9375rem;
    transition:
      border-color 200ms ease-out,
      box-shadow 150ms ease-out,
      background-color 200ms ease-out;
    outline: none;
  }

  .form-field input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .form-field input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    background: rgba(255, 255, 255, 0.08);
  }

  .form-field input[aria-invalid="true"] {
    border-color: rgba(239, 68, 68, 0.6);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
  }

  .field-error {
    margin: 0;
    font-size: 0.75rem;
    color: #fca5a5;
  }

  /* Radios / checkboxes */

  .radio-row {
    display: flex;
    gap: 1rem;
  }

  .radio-label,
  .checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }

  .radio-label input[type="radio"],
  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: #6366f1;
    cursor: pointer;
  }

  /* ----------------------------------------------------------------------
   * Status banners (Test connection feedback)
   * ---------------------------------------------------------------------- */

  .status-banner {
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .status-success {
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #bbf7d0;
  }

  .status-error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
  }

  /* ----------------------------------------------------------------------
   * Buttons
   * ---------------------------------------------------------------------- */

  .primary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem 1rem;
    border-radius: 0.625rem;
    border: none;
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    color: #ffffff;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
    transition:
      opacity 200ms ease-out,
      box-shadow 200ms ease-out,
      transform 100ms ease-out;
  }

  .primary-btn:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 6px 18px rgba(99, 102, 241, 0.4);
  }

  .primary-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .primary-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  .primary-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), 0 4px 14px rgba(99, 102, 241, 0.3);
  }

  .secondary-btn {
    padding: 0.625rem 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
  }

  .secondary-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.22);
  }

  .secondary-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.45);
  }

  /* ----------------------------------------------------------------------
   * Auto-schedule section
   * ---------------------------------------------------------------------- */

  .section-hint {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.5);
  }

  .auto-fieldset {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
    transition: opacity 200ms ease-out;
  }

  .auto-fieldset:disabled {
    opacity: 0.45;
  }

  /* Day-of-week toggle chips */
  .day-toggle-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .day-toggle {
    flex: 1 1 0;
    min-width: 2.25rem;
    padding: 0.4375rem 0.25rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease-out,
      border-color 150ms ease-out,
      color 150ms ease-out;
    outline: none;
  }

  .day-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .day-toggle.active {
    background: rgba(99, 102, 241, 0.25);
    border-color: rgba(99, 102, 241, 0.6);
    color: #e0e7ff;
  }

  .day-toggle:focus-visible {
    box-shadow: var(--focus-ring);
  }

  /* Activity list */
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .activity-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  .activity-grid {
    display: grid;
    grid-template-columns: 1fr 4.5rem 5rem;
    gap: 0.5rem;
  }

  .activity-date-range {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .mini-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .mini-field > span {
    font-size: 0.6875rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    letter-spacing: 0.02em;
  }

  .mini-field input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font-size: 0.875rem;
    font-family: inherit;
    color-scheme: dark;
    outline: none;
    transition:
      border-color 200ms ease-out,
      box-shadow 150ms ease-out,
      background-color 200ms ease-out;
  }

  .mini-field input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .mini-field input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    background: rgba(255, 255, 255, 0.08);
  }

  .activity-remove {
    align-self: flex-end;
    padding: 0.3125rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 150ms ease-out;
    outline: none;
  }

  .activity-remove:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  .activity-remove:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .add-activity-btn {
    align-self: flex-start;
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px dashed rgba(255, 255, 255, 0.22);
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease-out,
      border-color 150ms ease-out;
    outline: none;
  }

  .add-activity-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .add-activity-btn:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
