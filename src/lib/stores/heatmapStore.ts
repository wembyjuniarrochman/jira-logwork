import type { WorklogDay } from "./worklogStore";

export type { WorklogDay } from "./worklogStore";

export interface HeatmapCell {
  date: string; // YYYY-MM-DD
  hours: number; // sum of hours that day
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface Heatmap {
  range: HeatmapRange;
  cells: HeatmapCell[];
}

/**
 * Pure: bucket hours into one of five intensity levels (R5.2).
 *
 * Buckets:
 *   0 → hours === 0
 *   1 → 0 < hours < 2
 *   2 → 2 ≤ hours < 4
 *   3 → 4 ≤ hours < 8
 *   4 → hours ≥ 8
 *
 * Negative or NaN inputs collapse to 0.
 */
export function intensityFor(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours >= 8) return 4;
  if (hours >= 4) return 3;
  if (hours >= 2) return 2;
  if (hours > 0) return 1;
  return 0;
}

/**
 * Format a Date as a local-time YYYY-MM-DD string. Working from local
 * components avoids any timezone shift that would otherwise rotate the
 * heatmap by a day for non-UTC users.
 */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add `days` calendar days to a Date in local time. Reconstructing from
 * (year, month, date) keeps the result on the intended calendar day across
 * DST transitions.
 */
function addDays(d: Date, days: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Pure: produce `7 * weeks` cells ending on the Saturday of the week
 * containing `today`.
 *
 * Per design Property 4:
 *  - cells.length === 7 * weeks
 *  - cells form a contiguous, gap-free date range
 *  - max cell date = Saturday of the week containing `today`
 *  - min cell date = Saturday minus (7 * weeks - 1) days
 *  - range.startDate / range.endDate match the min / max cell dates
 */
export function buildHeatmap(
  worklogsByDate: Record<string, WorklogDay>,
  weeks: number,
  today: Date,
): Heatmap {
  const totalDays = 7 * weeks;
  // Sunday = 0, ..., Saturday = 6. Snap forward to Saturday of `today`'s week.
  const daysToSaturday = 6 - today.getDay();
  const saturday = addDays(today, daysToSaturday);
  const startDate = addDays(saturday, -(totalDays - 1));

  const cells: HeatmapCell[] = new Array(totalDays);
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(startDate, i);
    const date = toYMD(d);
    const hours = worklogsByDate[date]?.totalHours ?? 0;
    cells[i] = { date, hours, intensity: intensityFor(hours) };
  }

  return {
    range: { startDate: toYMD(startDate), endDate: toYMD(saturday) },
    cells,
  };
}

/**
 * Pure: keep only entries whose `author.emailAddress` matches `email`
 * after trimming and lowercasing both sides. Original order is preserved.
 */
export function filterByAuthorEmail<
  T extends { author?: { emailAddress?: string } },
>(worklogs: T[], email: string): T[] {
  const target = email.trim().toLowerCase();
  return worklogs.filter(
    (w) => w.author?.emailAddress?.toLowerCase() === target,
  );
}
