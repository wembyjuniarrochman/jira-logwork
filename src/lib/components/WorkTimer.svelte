<script lang="ts">
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
      <span class="timer-label">Tracking Time:</span>
      <span class="timer-task">{timerState.issueKey}</span>
    </div>

    <div class="timer-display">
      {formatTime(elapsedSeconds)}
    </div>

    <div class="timer-controls">
      {#if timerState.running}
        <button class="timer-btn pause" onclick={() => timerStore.pause()} title="Pause">
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
      {:else}
        <button class="timer-btn play" onclick={() => timerStore.resume()} title="Resume">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      {/if}

      <button class="timer-btn stop" onclick={handleStop} title="Stop & Log Work">
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
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
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
    color: rgba(255, 255, 255, 0.4);
    font-weight: 700;
  }

  .timer-task {
    font-size: 0.875rem;
    font-weight: 700;
    color: #c7d2fe;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .timer-display {
    font-size: 1.5rem;
    font-weight: 700;
    color: #ffffff;
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
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  .timer-btn svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .timer-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    transform: scale(1.05);
  }

  .timer-btn.stop {
    background: rgba(244, 63, 94, 0.15);
    color: #fda4af;
  }

  .timer-btn.stop:hover {
    background: rgba(244, 63, 94, 0.25);
  }

  .timer-btn.play {
    color: #86efac;
  }
</style>
