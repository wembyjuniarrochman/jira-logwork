<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  import { timerStore } from "../stores/timerStore";
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";

  let elapsedSeconds = $state(0);
  let timerState = $state({
    issueKey: null as string | null,
    summary: null as string | null,
    running: false,
    accumulatedSeconds: 0,
    startTime: null as number | null,
  });

  let intervalId: number | null = null;

  // Subscribe to the store
  const unsubscribe = timerStore.subscribe((s) => {
    timerState = s;
    updateDisplay();
  });

  function updateDisplay() {
    if (timerState.running && timerState.startTime) {
      const live = (Date.now() - timerState.startTime) / 1000;
      elapsedSeconds = timerState.accumulatedSeconds + live;
    } else {
      elapsedSeconds = timerState.accumulatedSeconds;
    }
  }

  onMount(() => {
    intervalId = window.setInterval(updateDisplay, 1000);
  });

  onDestroy(() => {
    unsubscribe();
    if (intervalId) clearInterval(intervalId);
  });

  function formatTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  const { onLog } = $props<{ onLog: (issueKey: string, summary: string, seconds: number) => void }>();

  function handleStop() {
    if (timerState.issueKey && timerState.summary) {
      // Pause first to get final duration
      timerStore.pause();
      // Pass total seconds to parent
      onLog(timerState.issueKey, timerState.summary, elapsedSeconds);
      // Reset store
      timerStore.reset();
    }
  }
</script>

{#if timerState.issueKey}
  <div class="work-timer glass" transition:fade>
    <div class="timer-info">
      <span class="timer-label">{t("timer.tracking")}</span>
      <span class="timer-task">{timerState.issueKey}</span>
    </div>

    <div class="timer-display">
      {formatTime(elapsedSeconds)}
    </div>

    <div class="timer-controls">
      {#if timerState.running}
        <button class="timer-btn pause" onclick={() => timerStore.pause()} title={t("timer.pause")}>
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
      {:else}
        <button class="timer-btn play" onclick={() => timerStore.resume()} title={t("timer.resume")}>
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      {/if}

      <button class="timer-btn stop" onclick={handleStop} title="{t("timer.stopAndLog")}">
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .work-timer {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 0.75rem 1.25rem;
    border-radius: 1rem;
    background: rgb(var(--surface-rgb) / 0.4);
    border: 1px solid rgb(var(--fg-rgb) / 0.1);
    box-shadow: 0 8px 32px rgb(var(--shadow-rgb) / calc(0.2 * var(--shadow-strength)));
    backdrop-filter: blur(12px);
    margin-bottom: 1rem;
  }

  .timer-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .timer-label {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(var(--fg-rgb) / 0.4);
    font-weight: 700;
  }

  .timer-task {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-accent-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .timer-display {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    min-width: 7rem;
    text-align: center;
  }

  .timer-controls {
    display: flex;
    gap: 0.5rem;
  }

  .timer-btn {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.625rem;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease-out;
    background: rgb(var(--fg-rgb) / 0.05);
    color: white;
  }

  .timer-btn svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .timer-btn:hover {
    background: rgb(var(--fg-rgb) / 0.12);
    transform: scale(1.05);
  }

  .timer-btn.stop {
    background: rgba(244, 63, 94, 0.15);
    color: var(--text-danger);
  }

  .timer-btn.stop:hover {
    background: rgba(244, 63, 94, 0.25);
  }

  .timer-btn.play {
    color: var(--text-success);
  }
</style>
