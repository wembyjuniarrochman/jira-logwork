/**
 * App language store + tiny translation helper.
 *
 * Universal-reactive (`$state` in a `.svelte.ts` module) so every component
 * that calls `t()` / `lang()` re-renders when the language changes. The choice
 * is persisted to localStorage. Default is Indonesian (the app's original
 * language).
 *
 * Coverage is incremental — strings are migrated to `DICT` per component. Any
 * key not in the dictionary falls back to the key itself, so missing
 * translations are visible rather than blank.
 */

export type Lang = "en" | "id";

const STORAGE_KEY = "appLanguage";

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "id") return v;
  } catch {
    /* localStorage may be unavailable — fall through to default */
  }
  return "id";
}

let current = $state<Lang>(readInitial());

/** Current language (reactive when read inside a component). */
export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore persistence failures */
  }
}

type Entry = { en: string; id: string };

const DICT: Record<string, Entry> = {
  // Calendar
  "calendar.day": { en: "Day", id: "Hari" },
  "calendar.week": { en: "Week", id: "Minggu" },
  "calendar.month": { en: "Month", id: "Bulan" },
  "calendar.list": { en: "List", id: "Daftar" },
  "calendar.today": { en: "Today", id: "Hari ini" },
  "calendar.prevPeriod": { en: "Previous period", id: "Periode sebelumnya" },
  "calendar.nextPeriod": { en: "Next period", id: "Periode berikutnya" },
  "calendar.periodTotal": { en: "Period total", id: "Total periode" },
  "calendar.more": { en: "more", id: "lagi" },
  "calendar.break": { en: "Break", id: "Istirahat" },
  "calendar.emptyList": {
    en: "No worklogs in this range yet.",
    id: "Belum ada worklog di rentang ini.",
  },
  "calendar.emptyDay": {
    en: "No worklog on this date.",
    id: "Tidak ada worklog di tanggal ini.",
  },
  "common.loading": { en: "Loading", id: "Memuat" },
};

/** Translate a key for the current language; falls back to the key. */
export function t(key: string): string {
  const entry = DICT[key];
  return entry ? entry[current] : key;
}
