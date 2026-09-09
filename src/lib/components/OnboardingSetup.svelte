<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  import {
    DEFAULT_WORKSPACE_SETTINGS,
    saveWorkspaceSettings,
    validateWorkspaceSettings,
  } from "../stores/settingsStore";
  import {
    DEFAULT_BREAK_CONFIG,
    parseHHmm,
    saveBreakConfig,
  } from "../stores/breakStore";
  import { completeOnboarding } from "../stores/onboardingStore";

  interface Props { onComplete: () => void }
  let { onComplete }: Props = $props();

  let targetHours = $state(DEFAULT_WORKSPACE_SETTINGS.targetHours);
  let workdayStart = $state(DEFAULT_WORKSPACE_SETTINGS.workdayStart);
  let workdayEnd = $state(DEFAULT_WORKSPACE_SETTINGS.workdayEnd);
  let breakEnabled = $state(DEFAULT_BREAK_CONFIG.enabled);
  let breakStart = $state(DEFAULT_BREAK_CONFIG.start);
  let breakEnd = $state(DEFAULT_BREAK_CONFIG.end);
  let saving = $state(false);
  let error = $state("");

  async function save(): Promise<void> {
    const settings = {
      ...DEFAULT_WORKSPACE_SETTINGS,
      targetHours: Number(targetHours),
      workdayStart,
      workdayEnd,
    };
    const validation = validateWorkspaceSettings(settings);
    const breakStartMin = parseHHmm(breakStart);
    const breakEndMin = parseHHmm(breakEnd);
    if (!validation.valid) {
      error = validation.errors.targetHours || validation.errors.workdayHours || t("onboarding.invalidHours");
      return;
    }
    if (breakEnabled && (breakStartMin === null || breakEndMin === null || breakEndMin <= breakStartMin)) {
      error = t("onboarding.invalidBreak");
      return;
    }
    saving = true;
    error = "";
    try {
      await saveWorkspaceSettings(settings);
      await saveBreakConfig({
        ...DEFAULT_BREAK_CONFIG,
        enabled: breakEnabled,
        start: breakStart,
        end: breakEnd,
      });
      await completeOnboarding();
      onComplete();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      saving = false;
    }
  }
</script>

<div class="onboarding-page" data-force-theme="dark">
  <section class="setup-card" aria-labelledby="onboarding-title">
    <div class="step">{t("onboarding.step")}</div>
    <h1 id="onboarding-title">{t("onboarding.title")}</h1>
    <p class="intro">{t("onboarding.intro")}</p>

    <div class="fields">
      <label>
        <span>{t("settings.dailyTarget")}</span>
        <input type="number" min="1" max="12" step="0.5" bind:value={targetHours} disabled={saving} />
      </label>
      <div class="row">
        <label>
          <span>{t("settings.workdayStart")}</span>
          <input type="time" bind:value={workdayStart} disabled={saving} />
        </label>
        <label>
          <span>{t("settings.workdayEnd")}</span>
          <input type="time" bind:value={workdayEnd} disabled={saving} />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={breakEnabled} disabled={saving} />
        <span>{t("settings.breakEnable")}</span>
      </label>
      {#if breakEnabled}
        <div class="row">
          <label>
            <span>{t("settings.breakStart")}</span>
            <input type="time" bind:value={breakStart} disabled={saving} />
          </label>
          <label>
            <span>{t("settings.breakEnd")}</span>
            <input type="time" bind:value={breakEnd} disabled={saving} />
          </label>
        </div>
      {/if}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="continue" type="button" onclick={save} disabled={saving}>
      {saving ? t("onboarding.saving") : t("onboarding.continue")}
    </button>
    <p class="hint">{t("onboarding.changeLater")}</p>
  </section>
</div>

<style>
  .onboarding-page { position: fixed; inset: 0; display: grid; place-items: center; overflow: auto; padding: 2rem 1rem; background: radial-gradient(circle at top, #202452, #090d1d 65%); color: var(--text-primary); }
  .setup-card { width: min(34rem, 100%); padding: 2rem; border: 1px solid rgb(var(--fg-rgb) / .14); border-radius: 1.25rem; background: #171c2b; box-shadow: 0 24px 70px rgb(0 0 0 / .45); }
  .step { color: var(--text-accent-strong); font-size: .75rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  h1 { margin: .5rem 0; font-size: 1.65rem; }
  .intro, .hint { color: rgb(var(--fg-rgb) / .65); line-height: 1.5; }
  .fields { display: flex; flex-direction: column; gap: 1rem; margin: 1.5rem 0; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  label { display: flex; flex-direction: column; gap: .45rem; font-size: .8125rem; font-weight: 600; }
  input { width: 100%; padding: .72rem .85rem; border: 1px solid rgb(var(--fg-rgb) / .14); border-radius: .65rem; background: rgb(var(--fg-rgb) / .06); color: var(--text-primary); color-scheme: dark; }
  .check { flex-direction: row; align-items: center; font-weight: 500; }
  .check input { width: 1rem; accent-color: #7567ec; }
  .continue { width: 100%; padding: .8rem; border: 0; border-radius: .7rem; background: linear-gradient(135deg, var(--accent-from), var(--accent-to)); color: white; font-weight: 700; cursor: pointer; }
  .continue:disabled { opacity: .6; cursor: wait; }
  .error { color: var(--text-danger); font-size: .8rem; }
  .hint { margin: .75rem 0 0; text-align: center; font-size: .75rem; }
  @media (max-width: 480px) { .row { grid-template-columns: 1fr; } .setup-card { padding: 1.4rem; } }
</style>
