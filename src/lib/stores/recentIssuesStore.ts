/**
 * Recent issues cache: per-user list of the most recently logged-to Jira issues.
 *
 * The cache is persisted in the Tauri store file `recent-issues.json` under a
 * single top-level key `"users"` whose value is a record mapping a normalized
 * email (trimmed + lowercased) to the user's `RecentIssue[]`.
 *
 *   {
 *     "users": {
 *       "user@example.com":  [{ issueKey, summary, lastUsedAt }, ...],
 *       "other@example.com": [...]
 *     }
 *   }
 *
 * Pure functions (`cacheKeyForEmail`, `upsertRecentIssue`) live alongside the
 * I/O helpers (`loadRecentIssues`, `saveRecentIssues`) so the logic can be
 * unit-tested without Tauri.
 */

export interface RecentIssue {
  /** Issue key, e.g. "PROJ-123". */
  issueKey: string;
  /** Raw issue summary from Jira. */
  summary: string;
  /** ISO 8601 timestamp string from `new Date().toISOString()`. */
  lastUsedAt: string;
  /**
   * Nama issue type dari Jira ("Task", "Epic", "Sub-task", …), dipakai untuk
   * ikon tipe di daftar recent.
   *
   * Opsional: entri yang sudah tersimpan sebelum field ini ada tidak
   * memilikinya, dan `loadRecentIssues` sengaja tidak memvalidasi bentuk —
   * entri lama tetap terbaca, hanya tanpa ikon, lalu terisi sendiri saat
   * issue-nya dipakai lagi.
   */
  issueType?: string;
}

/** Maximum number of entries retained per user. */
export const RECENT_ISSUES_MAX = 10;

/** Filename used inside the Tauri store. */
const STORE_FILE = "recent-issues.json";

/** Top-level key inside the store file holding the per-user map. */
const USERS_KEY = "users";

/**
 * Pure: normalize an email to its cache-key form.
 *
 * Two emails differing only in surrounding whitespace or letter case map to
 * the same key, so a user's cache is stable across login forms with slightly
 * different inputs.
 */
export function cacheKeyForEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pure: upsert an issue into the cache.
 *
 * Bumps the issue's `lastUsedAt` to `now`, dedupes by `issueKey`, sorts by
 * `lastUsedAt` in non-increasing order (most-recent first), and trims to
 * `RECENT_ISSUES_MAX` entries. Prior entries that are not the upserted issue
 * keep their original `lastUsedAt`.
 */
export function upsertRecentIssue(
  cache: RecentIssue[],
  issue: { issueKey: string; summary: string; issueType?: string },
  now: Date = new Date()
): RecentIssue[] {
  // Pertahankan tipe yang sudah tersimpan bila pemanggil kali ini tidak
  // membawanya: tidak semua jalur submit tahu tipe issue-nya, dan ikon yang
  // sudah benar tidak seharusnya hilang gara-gara dicatat lewat jalur lain.
  const previous = cache.find((entry) => entry.issueKey === issue.issueKey);
  const issueType = issue.issueType ?? previous?.issueType;

  const upserted: RecentIssue = {
    issueKey: issue.issueKey,
    summary: issue.summary,
    lastUsedAt: now.toISOString(),
    ...(issueType ? { issueType } : {}),
  };

  const withoutDuplicate = cache.filter((entry) => entry.issueKey !== issue.issueKey);
  const combined = [upserted, ...withoutDuplicate];

  combined.sort((a, b) => {
    if (a.lastUsedAt > b.lastUsedAt) return -1;
    if (a.lastUsedAt < b.lastUsedAt) return 1;
    return 0;
  });

  return combined.slice(0, RECENT_ISSUES_MAX);
}

/** Internal: shape of the value stored under the `"users"` key. */
type UsersMap = Record<string, RecentIssue[]>;

/**
 * Load the recent-issues cache for the given email.
 *
 * Returns `[]` on any error (missing file, plugin failure, malformed data),
 * so callers can render a usable empty state without special-casing failure.
 */
export async function loadRecentIssues(email: string): Promise<RecentIssue[]> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE);
    const users = (await store.get<UsersMap>(USERS_KEY)) ?? {};
    const cache = users[cacheKeyForEmail(email)];
    return Array.isArray(cache) ? cache : [];
  } catch {
    return [];
  }
}

/**
 * Persist the recent-issues cache for the given email, leaving other users'
 * caches intact.
 */
export async function saveRecentIssues(email: string, cache: RecentIssue[]): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(STORE_FILE);
  const users = (await store.get<UsersMap>(USERS_KEY)) ?? {};
  users[cacheKeyForEmail(email)] = cache;
  await store.set(USERS_KEY, users);
  await store.save();
}
