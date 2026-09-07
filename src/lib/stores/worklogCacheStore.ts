import type { WorklogDay } from "./worklogStore";

/**
 * Persisted cache for `get_my_worklogs` responses, keyed per
 * (email, baseUrl, startDate, endDate). The cache is read on Workspace
 * mount so the heatmap can paint instantly from the previous session,
 * then revalidated in the background (stale-while-revalidate).
 *
 * Storage: `worklog-cache.json` via `tauri-plugin-store`. When the
 * Tauri runtime is unavailable (browser preview, tests), every method
 * falls back to a no-op so callers don't have to special-case.
 */

const STORE_FILE = "worklog-cache.json";

/** Default freshness: cache entries newer than this are returned as
 * `fresh: true` and the caller may skip revalidation altogether.
 * Anything older still hydrates the UI immediately but triggers a
 * background refresh. */
export const DEFAULT_FRESH_MS = 5 * 60 * 1000; // 5 minutes

/** Hard expiry: anything older than this is dropped on read so we don't
 * keep stale data around forever. */
export const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface WorklogCacheEntry {
  /** Local-time YYYY-MM-DD; matches the request range. */
  startDate: string;
  endDate: string;
  /** Aggregated worklogs (already author-filtered by the backend). */
  worklogsByDate: Record<string, WorklogDay>;
  /** Epoch ms when this entry was written. */
  cachedAt: number;
}

export interface WorklogCacheLookup {
  entry: WorklogCacheEntry;
  /** True iff `cachedAt` is within `freshMs` of now. */
  fresh: boolean;
}

/** Pure: build the storage key for an entry. Lowercased + trimmed so
 *  trivial credential differences don't fragment the cache. */
export function cacheKey(
  email: string,
  baseUrl: string,
  startDate: string,
  endDate: string,
): string {
  const e = email.trim().toLowerCase();
  const b = baseUrl.trim().toLowerCase().replace(/\/+$/, "");
  return `${e}|${b}|${startDate}|${endDate}`;
}

async function getStore() {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    return await load(STORE_FILE);
  } catch {
    return null;
  }
}

/**
 * Read a cached entry. Returns `null` when:
 *   - the Tauri store is unavailable
 *   - no entry exists for the key
 *   - the entry is older than `expiryMs` (it will also be deleted)
 *
 * `fresh` is true when the entry is younger than `freshMs`.
 */
/**
 * Pure: detect cache entries written by a previous app version that lacked
 * the `id` field on `WorklogEntry`. Such entries can't be drag-and-dropped
 * because the calendar needs the worklog id to call `update_worklog`. We
 * treat them as invalid and re-fetch from Jira to backfill the field.
 *
 * Returns true iff every entry in every date has a non-empty `id`.
 */
export function isCacheCompatibleWithDnd(
  worklogsByDate: Record<string, WorklogDay>,
): boolean {
  for (const day of Object.values(worklogsByDate)) {
    for (const entry of day?.entries ?? []) {
      if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
        return false;
      }
    }
  }
  return true;
}

export async function readCache(
  email: string,
  baseUrl: string,
  startDate: string,
  endDate: string,
  now: number = Date.now(),
  freshMs: number = DEFAULT_FRESH_MS,
  expiryMs: number = DEFAULT_EXPIRY_MS,
): Promise<WorklogCacheLookup | null> {
  const store = await getStore();
  if (!store) return null;
  const key = cacheKey(email, baseUrl, startDate, endDate);
  try {
    const raw = await store.get<WorklogCacheEntry>(key);
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.cachedAt !== "number") return null;
    const age = now - raw.cachedAt;
    if (age > expiryMs) {
      // Drop expired entries on read so the file doesn't grow unbounded.
      await store.delete(key);
      await store.save();
      return null;
    }
    // Drop entries from prior app versions where WorklogEntry didn't carry
    // `id` — the calendar's drag-and-drop needs it, so paint nothing and
    // force a fresh fetch.
    if (!isCacheCompatibleWithDnd(raw.worklogsByDate ?? {})) {
      await store.delete(key);
      await store.save();
      return null;
    }
    return { entry: raw, fresh: age <= freshMs };
  } catch {
    return null;
  }
}

/** Write (or overwrite) a cache entry for the given key. Failures are
 *  swallowed — the cache is best-effort and must never block the UI. */
export async function writeCache(
  email: string,
  baseUrl: string,
  startDate: string,
  endDate: string,
  worklogsByDate: Record<string, WorklogDay>,
  now: number = Date.now(),
): Promise<void> {
  const store = await getStore();
  if (!store) return;
  const key = cacheKey(email, baseUrl, startDate, endDate);
  const entry: WorklogCacheEntry = {
    startDate,
    endDate,
    worklogsByDate,
    cachedAt: now,
  };
  try {
    await store.set(key, entry);
    await store.save();
  } catch {
    /* swallow — caching is best-effort */
  }
}

/** Drop every entry for a given email — used when the user logs out so
 *  the next user doesn't see prior data. */
export async function clearCacheForEmail(email: string): Promise<void> {
  const store = await getStore();
  if (!store) return;
  const target = `${email.trim().toLowerCase()}|`;
  try {
    const keys = await store.keys();
    let touched = false;
    for (const k of keys) {
      if (k.startsWith(target)) {
        await store.delete(k);
        touched = true;
      }
    }
    if (touched) await store.save();
  } catch {
    /* swallow */
  }
}
