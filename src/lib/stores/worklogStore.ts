export interface WorklogEntry {
  /** Jira worklog id (e.g. "10234"). Required to update the worklog via
   *  `PUT /issue/{key}/worklog/{id}` — without it the calendar can't
   *  drag-and-drop the entry to a different date. May be undefined for
   *  legacy entries persisted in the cache before this field existed. */
  id?: string;
  issueKey: string;
  hours: number;
  /** Original `started` timestamp from Jira, kept in ISO 8601 so the
   *  drag-and-drop update can preserve the time-of-day component when
   *  moving the worklog to a different date. */
  started?: string;
  /** Raw `timeSpentSeconds` from Jira. Kept alongside `hours` so the
   *  update call can echo the exact value back without re-encoding from
   *  a rounded hours float. */
  timeSpentSeconds?: number;
  description: string;
  summary?: string;
  author?: string;
  /** True untuk entri draf (belum ada di Jira) — mis. hasil generate
   *  penjadwalan otomatis yang menunggu direview & disubmit user. */
  pending?: boolean;
}

export interface WorklogDay {
  totalHours: number;
  entries: WorklogEntry[];
}

export function groupWorklogsByDate(
  worklogs: any[],
  issueKey: string,
): Record<string, WorklogDay> {
  const map: Record<string, WorklogDay> = {};
  for (const wl of worklogs) {
    if (!wl.started) continue;
    const date = wl.started.substring(0, 10);
    if (!map[date]) map[date] = { totalHours: 0, entries: [] };
    const hours = wl.time_spent_seconds / 3600;
    map[date].totalHours += hours;
    map[date].entries.push({ issueKey, hours, description: "" });
  }
  return map;
}

export function mergeWorklogs(
  a: Record<string, WorklogDay>,
  b: Record<string, WorklogDay>,
): Record<string, WorklogDay> {
  const result = { ...a };
  for (const [date, day] of Object.entries(b)) {
    if (!result[date]) result[date] = { totalHours: 0, entries: [] };
    result[date].totalHours += day.totalHours;
    result[date].entries.push(...day.entries);
  }
  return result;
}
