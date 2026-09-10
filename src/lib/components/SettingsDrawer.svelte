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

  import { t } from "../stores/i18n.svelte";
  import { tick, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    type WorkspaceSettings,
    validateWorkspaceSettings,
    saveWorkspaceSettings,
  } from "../stores/settingsStore";
  import {
    type AiSettings,
    saveAiSettings,
  } from "../stores/aiSettingsStore";
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
  import {
    loadBreakConfig,
    saveBreakConfig,
    DEFAULT_BREAK_CONFIG,
    parseHHmm,
    type BreakConfig,
  } from "../stores/breakStore";
  import { checkForUpdate, currentVersion } from "../stores/updaterStore";
  import { requestUpdateCheck } from "../stores/updateSignal.svelte";
  import {
    themePreference,
    setThemePreference,
    resolvedTheme,
    type ThemePreference,
  } from "../stores/themeStore.svelte";

  interface Props {
    open: boolean;
    initialSettings: WorkspaceSettings;
    initialAiSettings: AiSettings;
    initialCredentials: Credentials;
    initialIsCloud: boolean;
    initialAutoSchedule: AutoScheduleConfig;
    onClose: () => void;
    onSettingsSaved: (next: WorkspaceSettings) => void;
    onAiSettingsSaved: (next: AiSettings) => void;
    onCredentialsSaved: (next: Credentials, isCloud: boolean) => void;
    onAutoScheduleSaved: (next: AutoScheduleConfig) => void;
    /** Dipanggil setelah jam istirahat disimpan, supaya kalender langsung
     *  memakai nilai baru tanpa menunggu aplikasi dibuka ulang. */
    onBreakSaved: (next: BreakConfig) => void;
  }

  let {
    open,
    initialSettings,
    initialAiSettings,
    initialCredentials,
    initialIsCloud,
    initialAutoSchedule,
    onClose,
    onSettingsSaved,
    onAiSettingsSaved,
    onCredentialsSaved,
    onAutoScheduleSaved,
    onBreakSaved,
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
  let workdayStart = $state("09:00");
  let workdayEnd = $state("18:00");

  // The key itself is intentionally never loaded into this component. It is
  // saved by native Tauri commands to the OS keychain.
  let aiEnabled = $state(false);
  let aiProvider = $state<AiSettings["provider"]>("openai");
  let aiLanguage = $state<AiSettings["language"]>("auto");
  let aiApiKey = $state("");
  let aiHasKey = $state(false);
  let aiStatus = $state<string | null>(null);
  let aiStatusError = $state(false);
  let aiTesting = $state(false);

  // Inline validation errors for the Reminder + Target Hours sections.
  let settingsErrors = $state<{ reminderHour?: string; targetHours?: string; workdayHours?: string }>({});

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
        workdayStart = initialSettings.workdayStart;
        workdayEnd = initialSettings.workdayEnd;
        aiEnabled = initialAiSettings.enabled;
        aiProvider = initialAiSettings.provider;
        aiLanguage = initialAiSettings.language;
        aiApiKey = "";
        aiStatus = null;
        aiStatusError = false;
        aiTesting = false;
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
      void (async () => {
        const b = await loadBreakConfig();
        breakEnabled = b.enabled;
        breakStart = b.start;
        breakEnd = b.end;
        breakFridayEnd = b.fridayEnd;
      })();

      // Reflect the actual OS autostart entry (async; no-op off-Tauri).
      void (async () => {
        autoStartOnLogin = await isAutostartEnabled();
      })();
      // This must stay untracked. `refreshAiKeyStatus` reads `aiProvider`;
      // tracking that read would rerun this whole open lifecycle whenever a
      // user picks another provider and reset it back to the saved value.
      void untrack(() => refreshAiKeyStatus());

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
      workdayStart,
      workdayEnd,
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

  async function saveAiPreferences(): Promise<void> {
    const key = aiApiKey.trim();
    if (aiEnabled && !aiHasKey && !key) {
      aiStatusError = true;
      aiStatus = "Masukkan API key provider yang dipilih sebelum mengaktifkan bantuan AI.";
      return;
    }
    try {
      if (key) {
        await invoke("save_ai_api_key", { provider: aiProvider, apiKey: key });
        aiHasKey = true;
        aiApiKey = "";
      }
      const next: AiSettings = { enabled: aiEnabled, provider: aiProvider, language: aiLanguage };
      await saveAiSettings(next);
      onAiSettingsSaved(next);
      aiStatusError = false;
      aiStatus = aiEnabled ? "Bantuan AI aktif untuk deskripsi worklog." : "Bantuan AI dinonaktifkan.";
    } catch (err) {
      aiStatusError = true;
      aiStatus = `Gagal menyimpan pengaturan AI: ${err}`;
    }
  }

  async function testAiApiKey(): Promise<void> {
    const key = aiApiKey.trim();
    if (!key) {
      aiStatusError = true;
      aiStatus = "Masukkan API key terlebih dahulu untuk diuji.";
      return;
    }
    aiTesting = true;
    aiStatusError = false;
    aiStatus = null;
    try {
      aiStatus = await invoke<string>("test_ai_api_key", { provider: aiProvider, apiKey: key });
    } catch (err) {
      aiStatusError = true;
      aiStatus = `API key tidak dapat digunakan: ${err}`;
    } finally {
      aiTesting = false;
    }
  }

  async function removeAiKey(): Promise<void> {
    try {
      await invoke("clear_ai_api_key", { provider: aiProvider });
      aiHasKey = false;
      aiApiKey = "";
      aiEnabled = false;
      const next: AiSettings = { enabled: false, provider: aiProvider, language: aiLanguage };
      await saveAiSettings(next);
      onAiSettingsSaved(next);
      aiStatusError = false;
      aiStatus = "API key dihapus dari penyimpanan key OS.";
    } catch (err) {
      aiStatusError = true;
      aiStatus = `Gagal menghapus API key: ${err}`;
    }
  }

  async function refreshAiKeyStatus(): Promise<void> {
    aiApiKey = "";
    aiStatus = null;
    aiStatusError = false;
    try {
      aiHasKey = await invoke<boolean>("has_ai_api_key", { provider: aiProvider });
    } catch (err) {
      aiHasKey = false;
      aiStatusError = true;
      aiStatus = `Tidak dapat memeriksa API key: ${err}`;
    }
  }

  function handleAiProviderChange(event: Event): void {
    const provider = (event.currentTarget as HTMLSelectElement).value;
    if (provider !== "openai" && provider !== "gemini" && provider !== "claude") return;

    // Commit the provider before the async keychain lookup. This avoids the
    // native select's change event racing with Svelte's two-way binding.
    aiProvider = provider;
    void refreshAiKeyStatus();
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
    await persistBreak();
    await persistAutoSchedule();
    await saveWorkspacePrefs();
    await saveAiPreferences();
  }

  // --- Derived submit-disabled state for the Test & Save button ----------
  let canTestConnection = $derived(
    connStatus !== "loading" &&
      baseUrl.trim().length > 0 &&
      email.trim().length > 0 &&
      apiToken.trim().length > 0
  );

  // --- Jam istirahat -------------------------------------------------------

  let breakEnabled = $state<boolean>(DEFAULT_BREAK_CONFIG.enabled);
  let breakStart = $state<string>(DEFAULT_BREAK_CONFIG.start);
  let breakEnd = $state<string>(DEFAULT_BREAK_CONFIG.end);
  let breakFridayEnd = $state<string>(DEFAULT_BREAK_CONFIG.fridayEnd);

  /** Pesan galat inline; jam selesai harus setelah jam mulai. */
  const breakError = $derived.by(() => {
    if (!breakEnabled) return null;
    const s = parseHHmm(breakStart);
    const e = parseHHmm(breakEnd);
    if (s === null || e === null) return "Format jam harus HH:mm.";
    if (e <= s) return "Jam selesai harus setelah jam mulai.";
    if (breakFridayEnd.trim() !== "") {
      const f = parseHHmm(breakFridayEnd);
      if (f === null) return "Format jam Jumat harus HH:mm.";
      if (f <= s) return "Jam selesai Jumat harus setelah jam mulai.";
    }
    return null;
  });

  async function persistBreak(): Promise<void> {
    if (breakError) return;
    const next: BreakConfig = {
      enabled: breakEnabled,
      start: breakStart,
      end: breakEnd,
      fridayEnd: breakFridayEnd,
    };
    await saveBreakConfig(next);
    // Tanpa ini nilainya tersimpan tapi kalender tetap memakai konfigurasi
    // lama sampai aplikasi dibuka ulang — mematikan opsi ini terlihat tidak
    // berpengaruh apa-apa.
    onBreakSaved(next);
  }

  // --- Tema ----------------------------------------------------------------

  const THEME_OPTIONS: ReadonlyArray<{
    value: ThemePreference;
    labelKey: string;
    icon: string;
  }> = [
    { value: "auto", labelKey: "settings.themeAuto", icon: "M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9zm0 0v18" },
    { value: "light", labelKey: "settings.themeLight", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M6 18l-1.5 1.5M19.5 4.5 18 6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
    { value: "dark", labelKey: "settings.themeDark", icon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  ];

  // Tema diterapkan seketika saat dipilih (bukan menunggu tombol Save),
  // karena efeknya langsung terlihat — menunda justru membingungkan.
  function chooseTheme(next: ThemePreference): void {
    setThemePreference(next);
  }

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
      aria-label={t("settings.panelLabel")}
      tabindex="-1"
      bind:this={panelEl}
      onkeydown={onPanelKeyDown}
    >
      <header class="drawer-header">
        <h2 class="drawer-title">{t("settings.title")}</h2>
        <button
          type="button"
          class="close-btn"
          aria-label={t("settings.close")}
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
          <h3 id="section-jira-connection" class="section-title">{t("settings.connection")}</h3>

          <div class="form-field">
            <span class="field-label">{t("settings.deployment")}</span>
            <div class="radio-row" role="radiogroup" aria-label={t("settings.deploymentLabel")}>
              <label class="radio-label">
                <input
                  type="radio"
                  name="settings-deployment"
                  bind:group={isCloud}
                  value={true}
                />
                <span>{t("settings.cloud")}</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  name="settings-deployment"
                  bind:group={isCloud}
                  value={false}
                />
                <span>{t("settings.server")}</span>
              </label>
            </div>
          </div>

          <div class="form-field">
            <label for="settings-base-url">{t("login.jiraUrl")}</label>
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
            <label for="settings-email">{t("login.email")}</label>
            <input
              id="settings-email"
              type="email"
              bind:value={email}
              placeholder={t("settings.emailPlaceholder")}
              autocomplete="email"
            />
          </div>

          <div class="form-field">
            <label for="settings-api-token">{t("login.apiToken")}</label>
            <input
              id="settings-api-token"
              type="password"
              bind:value={apiToken}
              placeholder={t("login.tokenPlaceholder")}
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
        <!-- Section 2 — AI description helper (optional, personal key)   -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-ai-description">
          <h3 id="section-ai-description" class="section-title">{t("settings.aiDescription")}</h3>
          <p class="section-hint">{t("settings.aiDescriptionHint")}</p>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={aiEnabled} />
            <span>{t("settings.aiEnable")}</span>
          </label>

          <fieldset class="auto-fieldset" disabled={!aiEnabled}>
            <div class="form-field">
              <label for="settings-ai-provider">{t("settings.aiProvider")}</label>
              <select id="settings-ai-provider" value={aiProvider} onchange={handleAiProviderChange}>
                <option value="openai">{t("settings.aiProviderOpenai")}</option>
                <option value="gemini">{t("settings.aiProviderGemini")}</option>
                <option value="claude">{t("settings.aiProviderClaude")}</option>
              </select>
              <span class="field-help">{t("settings.aiProviderHint")}</span>
            </div>
            <div class="form-field">
              <label for="settings-ai-language">{t("settings.aiLanguage")}</label>
              <select id="settings-ai-language" bind:value={aiLanguage}>
                <option value="auto">{t("settings.aiLanguageAuto")}</option>
                <option value="id">{t("settings.aiLanguageId")}</option>
                <option value="en">{t("settings.aiLanguageEn")}</option>
              </select>
            </div>
            <div class="form-field">
              <label for="settings-ai-api-key">{t("settings.aiApiKey")}</label>
              <input
                id="settings-ai-api-key"
                type="password"
                bind:value={aiApiKey}
                placeholder={aiHasKey ? t("settings.aiApiKeySaved") : aiProvider === "openai" ? "sk-..." : aiProvider === "gemini" ? "AIza..." : "sk-ant-..."}
                autocomplete="off"
              />
            </div>
          </fieldset>

          <div class="ai-actions">
            <button
              type="button"
              class="secondary-btn ai-save-settings"
              disabled={!aiEnabled}
              onclick={saveAiPreferences}
            >
              {t("settings.aiSave")}
            </button>
            <button
              type="button"
              class="secondary-btn ai-test-key"
              disabled={!aiEnabled || !aiApiKey.trim() || aiTesting}
              onclick={testAiApiKey}
            >
              {aiTesting ? t("settings.aiTesting") : t("settings.aiTest")}
            </button>
          </div>
          <p class="field-help">{t("settings.aiTestHint")}</p>

          {#if aiHasKey}
            <button type="button" class="secondary-btn ai-remove-key" onclick={removeAiKey}>
              {t("settings.aiRemoveKey")}
            </button>
          {/if}
          {#if aiStatus}
            <p class:field-error={aiStatusError} class="section-hint" role={aiStatusError ? "alert" : "status"}>
              {aiStatus}
            </p>
          {/if}
        </section>

        <!-- ============================================================ -->
        <!-- Section 2 — Reminder (R4.3)                                   -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-reminder">
          <h3 id="section-reminder" class="section-title">{t("settings.reminder")}</h3>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={reminderEnabled} />
            <span>{t("settings.reminderEnable")}</span>
          </label>

          <div class="form-field">
            <label for="settings-reminder-hour">{t("settings.reminderHour")}</label>
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
          <h3 id="section-target-hours" class="section-title">{t("settings.targetHours")}</h3>

          <div class="form-field">
            <label for="settings-target-hours">{t("settings.dailyTarget")}</label>
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
          <div class="break-times">
            <div class="form-field">
              <label for="settings-workday-start">{t("settings.workdayStart")}</label>
              <input id="settings-workday-start" type="time" bind:value={workdayStart} />
            </div>
            <div class="form-field">
              <label for="settings-workday-end">{t("settings.workdayEnd")}</label>
              <input id="settings-workday-end" type="time" bind:value={workdayEnd} />
            </div>
          </div>
          {#if settingsErrors.workdayHours}
            <p class="field-error" role="alert">{settingsErrors.workdayHours}</p>
          {/if}
        </section>

        <!-- ============================================================ -->
        <!-- Section 4 — Penjadwalan Otomatis (draf harian utk direview)  -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-auto-schedule">
          <h3 id="section-auto-schedule" class="section-title">
            {t("settings.autoSchedule")}
          </h3>
          <p class="section-hint">
            {t("settings.autoHint")}
          </p>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={autoEnabled} />
            <span>{t("settings.autoEnable")}</span>
          </label>

          <fieldset class="auto-fieldset" disabled={!autoEnabled}>
            <!-- Days of week -->
            <div class="form-field">
              <span class="field-label">{t("settings.activeDays")}</span>
              <div class="day-toggle-row" role="group" aria-label={t("settings.activeDays")}>
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
              <span>{t("settings.skipHolidays")}</span>
            </label>

            <label class="checkbox-label">
              <input type="checkbox" bind:checked={autoCatchUp} />
              <span>{t("settings.catchUp")}</span>
            </label>

            {#if autoCatchUp}
              <div class="form-field">
                <label for="auto-catchup-max">{t("settings.catchUpMax")}</label>
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
                <span>{t("settings.runAtLogin")}</span>
              </label>
              <p class="section-hint">
                {t("settings.autostartHint")}
              </p>
              {#if autoStartError}
                <p class="field-error" role="alert">{autoStartError}</p>
              {/if}
            </div>

            <!-- Activities -->
            <div class="form-field">
              <span class="field-label">{t("settings.activities")}</span>
              {#if autoActivities.length === 0}
                <p class="section-hint">
                  {t("settings.noActivities")}
                </p>
              {/if}

              <div class="activity-list">
                {#each autoActivities as activity (activity.id)}
                  <div class="activity-card">
                    <div class="activity-grid">
                      <label class="mini-field mini-issue">
                        <span>{t("settings.issueKey")}</span>
                        <input
                          type="text"
                          placeholder={t("settings.issueKeyPlaceholder")}
                          autocomplete="off"
                          spellcheck="false"
                          bind:value={activity.issueKey}
                        />
                      </label>
                      <label class="mini-field mini-hours">
                        <span>{t("settings.hours")}</span>
                        <input
                          type="number"
                          min="0.25"
                          max="24"
                          step="0.25"
                          bind:value={activity.hours}
                        />
                      </label>
                      <label class="mini-field mini-time">
                        <span>{t("settings.startTime")}</span>
                        <input type="time" bind:value={activity.startTime} />
                      </label>
                    </div>
                    <div class="activity-date-range">
                      <label class="mini-field mini-date">
                        <span>{t("settings.validFrom")}</span>
                        <input
                          type="date"
                          bind:value={activity.startDate}
                        />
                      </label>
                      <label class="mini-field mini-date">
                        <span>{t("settings.validUntil")}</span>
                        <input
                          type="date"
                          bind:value={activity.endDate}
                        />
                      </label>
                    </div>
                    <label class="mini-field">
                      <span>{t("settings.descriptionOptional")}</span>
                      <input
                        type="text"
                        placeholder={t("settings.workPlaceholder")}
                        maxlength="500"
                        bind:value={activity.description}
                      />
                    </label>
                    <button
                      type="button"
                      class="activity-remove"
                      aria-label={t("settings.removeActivity")}
                      onclick={() => removeAutoActivity(activity.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                {/each}
              </div>

              <button
                type="button"
                class="add-activity-btn"
                onclick={addAutoActivity}
              >
                {t("settings.addActivity")}
              </button>
            </div>
          </fieldset>
        </section>

        <!-- ============================================================ -->
        <!-- Section 5 — Tentang aplikasi                                 -->
        <!-- ============================================================ -->
        <!-- ============================================================ -->
        <!-- Section 5 — Jam istirahat                                    -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-break">
          <h3 id="section-break" class="section-title">{t("settings.break")}</h3>
          <p class="section-hint">
            {t("settings.breakHint")}
          </p>

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={breakEnabled} />
            <span>{t("settings.breakEnable")}</span>
          </label>

          <fieldset class="auto-fieldset" disabled={!breakEnabled}>
            <div class="break-times">
              <div class="form-field">
                <label for="break-start">{t("settings.breakStart")}</label>
                <input id="break-start" type="time" bind:value={breakStart} />
              </div>
              <div class="form-field">
                <label for="break-end">{t("settings.breakEnd")}</label>
                <input id="break-end" type="time" bind:value={breakEnd} />
              </div>
              <div class="form-field">
                <label for="break-friday">{t("settings.breakFriday")}</label>
                <input
                  id="break-friday"
                  type="time"
                  bind:value={breakFridayEnd}
                />
              </div>
            </div>
            <p class="section-hint">
              {t("settings.breakFridayHint")}
            </p>
            {#if breakError}
              <p class="field-error" role="alert">{breakError}</p>
            {/if}
          </fieldset>
        </section>

        <!-- ============================================================ -->
        <!-- Section 6 — Tampilan (tema)                                  -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-theme">
          <h3 id="section-theme" class="section-title">{t("settings.appearance")}</h3>
          <p class="section-hint">
            {t("settings.themeHint")}
          </p>

          <div class="theme-switch" role="radiogroup" aria-label={t("settings.themeLabel")}>
            {#each THEME_OPTIONS as opt (opt.value)}
              {@const checked = themePreference() === opt.value}
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                class="theme-chip"
                class:selected={checked}
                onclick={() => chooseTheme(opt.value)}
              >
                <svg
                  class="theme-chip-icon"
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
                <span>{t(opt.labelKey)}</span>
              </button>
            {/each}
          </div>

          {#if themePreference() === "auto"}
            <p class="section-hint">
              {t("settings.systemUsing")}
              <strong>{resolvedTheme() === "dark" ? "gelap" : "terang"}</strong>.
            </p>
          {/if}
        </section>

        <!-- ============================================================ -->
        <!-- Section 6 — Tentang aplikasi                                 -->
        <!-- ============================================================ -->
        <section class="drawer-section" aria-labelledby="section-about">
          <h3 id="section-about" class="section-title">{t("settings.about")}</h3>

          <dl class="about-list">
            <dt>{t("settings.app")}</dt>
            <dd>JIRA Logwork</dd>

            <dt>{t("settings.version")}</dt>
            <dd>
              {#if appVersion}
                <span class="about-version">{appVersion}</span>
              {:else}
                <span class="about-muted">—</span>
              {/if}
            </dd>

            <dt>{t("settings.author")}</dt>
            <dd>{APP_AUTHOR}</dd>

            <dt>{t("settings.sourceCode")}</dt>
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
              {updateChecking ? t("settings.checking") : t("settings.checkUpdate")}
            </button>
            {#if updateStatus}
              <span class="about-update-status">{updateStatus}</span>
            {/if}
          </div>
          <p class="section-hint">
            {t("settings.autoChecked")}
          </p>
        </section>
      </div>

      <footer class="drawer-footer">
        <button type="button" class="secondary-btn" onclick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" class="primary-btn" onclick={saveAll}>
          {t("common.save")}
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
    background-color: rgb(var(--surface-rgb) / 0);
    transition: background-color 250ms cubic-bezier(0.22, 1, 0.36, 1);
    display: flex;
    justify-content: flex-end;
  }

  .drawer-backdrop.visible {
    background-color: rgb(var(--surface-rgb) / 0.55);
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
    color: var(--text-primary);
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
    color: rgb(var(--fg-rgb) / 0.75);
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
    background: rgb(var(--fg-rgb) / 0.07);
    border-color: rgb(var(--fg-rgb) / 0.15);
    color: var(--text-strong);
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

  .break-times {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  /* --- Pemilih tema ----------------------------------------------------- */

  .theme-switch {
    display: flex;
    gap: 0.375rem;
  }

  .theme-chip {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4375rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.625rem;
    border: 1px solid var(--glass-border);
    background: rgb(var(--fg-rgb) / 0.03);
    color: rgb(var(--fg-rgb) / 0.6);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    transition:
      background 180ms ease-out,
      color 180ms ease-out,
      border-color 180ms ease-out;
  }

  .theme-chip:hover:not(.selected) {
    background: rgb(var(--fg-rgb) / 0.07);
    color: rgb(var(--fg-rgb) / 0.85);
  }

  .theme-chip.selected {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.55);
    color: var(--text-primary);
  }

  .theme-chip:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .theme-chip-icon {
    width: 0.9375rem;
    height: 0.9375rem;
    flex-shrink: 0;
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
    color: rgb(var(--fg-rgb) / 0.5);
  }

  .about-list dd {
    margin: 0;
    color: var(--text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .about-version {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .about-muted {
    color: rgb(var(--fg-rgb) / 0.4);
  }

  .about-link {
    color: var(--text-accent);
    text-decoration: none;
  }

  .about-link:hover {
    text-decoration: underline;
  }

  .about-copyright {
    margin: 0;
    font-size: 0.75rem;
    color: rgb(var(--fg-rgb) / 0.4);
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
    color: rgb(var(--fg-rgb) / 0.65);
  }

  .section-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgb(var(--fg-rgb) / 0.6);
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
    color: rgb(var(--fg-rgb) / 0.8);
    letter-spacing: 0.025em;
  }

  .form-field input[type="url"],
  .form-field input[type="email"],
  .form-field input[type="password"],
  .form-field input[type="number"] {
    width: 100%;
    padding: 0.625rem 0.875rem;
    border-radius: 0.625rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    color: var(--text-primary);
    font-size: 0.9375rem;
    transition:
      border-color 200ms ease-out,
      box-shadow 150ms ease-out,
      background-color 200ms ease-out;
    outline: none;
  }

  .form-field input::placeholder {
    color: rgb(var(--fg-rgb) / 0.35);
  }

  .form-field input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .form-field input[aria-invalid="true"] {
    border-color: rgba(239, 68, 68, 0.6);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
  }

  .field-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-danger);
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
    color: rgb(var(--fg-rgb) / 0.85);
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
    color: var(--text-success);
  }

  .status-error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--text-danger);
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
    color: var(--text-on-accent);
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
    border: 1px solid rgb(var(--fg-rgb) / 0.15);
    background: rgb(var(--fg-rgb) / 0.06);
    color: rgb(var(--fg-rgb) / 0.9);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
  }

  .secondary-btn:hover {
    background: rgb(var(--fg-rgb) / 0.1);
    border-color: rgb(var(--fg-rgb) / 0.22);
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
    color: rgb(var(--fg-rgb) / 0.5);
  }

  .field-help {
    margin-top: -0.5rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: rgb(var(--fg-rgb) / 0.5);
  }

  .ai-remove-key {
    align-self: flex-start;
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    color: var(--text-danger);
  }

  .ai-save-settings {
    white-space: nowrap;
  }

  .ai-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .ai-test-key {
    white-space: nowrap;
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
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.05);
    color: rgb(var(--fg-rgb) / 0.75);
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
    background: rgb(var(--fg-rgb) / 0.1);
  }

  .day-toggle.active {
    background: rgba(99, 102, 241, 0.25);
    border-color: rgba(99, 102, 241, 0.6);
    color: var(--text-accent-strong);
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
    border: 1px solid rgb(var(--fg-rgb) / 0.1);
    background: rgb(var(--fg-rgb) / 0.04);
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
    color: rgb(var(--fg-rgb) / 0.55);
    letter-spacing: 0.02em;
  }

  .mini-field input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    color: var(--text-primary);
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
    color: rgb(var(--fg-rgb) / 0.35);
  }

  .mini-field input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .activity-remove {
    align-self: flex-end;
    padding: 0.3125rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.12);
    color: var(--text-danger);
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
    border: 1px dashed rgb(var(--fg-rgb) / 0.22);
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.85);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease-out,
      border-color 150ms ease-out;
    outline: none;
  }

  .add-activity-btn:hover {
    background: rgb(var(--fg-rgb) / 0.06);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .add-activity-btn:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
