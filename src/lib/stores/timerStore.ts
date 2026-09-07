import { writable } from "svelte/store";

export interface TimerState {
  issueKey: string | null;
  summary: string | null;
  startTime: number | null; // Date.now() when started
  accumulatedSeconds: number;
  running: boolean;
}

const DEFAULT_STATE: TimerState = {
  issueKey: null,
  summary: null,
  startTime: null,
  accumulatedSeconds: 0,
  running: false,
};

function createTimerStore() {
  const { subscribe, set, update } = writable<TimerState>(loadFromStorage());

  function loadFromStorage(): TimerState {
    if (typeof localStorage === "undefined") return DEFAULT_STATE;
    const saved = localStorage.getItem("active_timer");
    if (!saved) return DEFAULT_STATE;
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_STATE;
    }
  }

  function saveToStorage(state: TimerState) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("active_timer", JSON.stringify(state));
    }
  }

  return {
    subscribe,
    start: (issueKey: string, summary: string) => {
      update((s) => {
        const next = {
          ...s,
          issueKey,
          summary,
          startTime: Date.now(),
          running: true,
        };
        saveToStorage(next);
        return next;
      });
    },
    pause: () => {
      update((s) => {
        if (!s.running || s.startTime === null) return s;
        const elapsed = (Date.now() - s.startTime) / 1000;
        const next = {
          ...s,
          accumulatedSeconds: s.accumulatedSeconds + elapsed,
          startTime: null,
          running: false,
        };
        saveToStorage(next);
        return next;
      });
    },
    resume: () => {
      update((s) => {
        if (s.running || !s.issueKey) return s;
        const next = {
          ...s,
          startTime: Date.now(),
          running: true,
        };
        saveToStorage(next);
        return next;
      });
    },
    reset: () => {
      set(DEFAULT_STATE);
      saveToStorage(DEFAULT_STATE);
    },
  };
}

export const timerStore = createTimerStore();
