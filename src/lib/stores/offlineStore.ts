export interface PendingWorklog {
  id: string;
  issueKey: string;
  timeSpentSeconds: number;
  started: string;
  comment: string;
  status: "pending" | "failed";
}

type PendingInput = Omit<PendingWorklog, "id" | "status">;

function normalizeComment(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function fingerprint(entry: PendingInput): string {
  return [
    entry.issueKey.trim().toUpperCase(),
    entry.started.slice(0, 16),
    Math.round(entry.timeSpentSeconds),
    normalizeComment(entry.comment),
  ].join("|");
}

export function isDuplicatePending(queue: PendingWorklog[], candidate: PendingInput): boolean {
  const expected = fingerprint(candidate);
  return queue.some((entry) => fingerprint(entry) === expected);
}

function commentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const item = node as { text?: unknown; content?: unknown };
    if (typeof item.text === "string") texts.push(item.text);
    if (Array.isArray(item.content)) item.content.forEach(walk);
  };
  walk(value);
  return texts.join(" ");
}

interface RemoteWorklog {
  time_spent_seconds?: number;
  timeSpentSeconds?: number;
  started?: string;
  comment?: unknown;
}

export function remoteContainsPending(remote: RemoteWorklog[], pending: PendingWorklog): boolean {
  return remote.some((entry) => {
    const seconds = entry.timeSpentSeconds ?? entry.time_spent_seconds ?? 0;
    return entry.started?.slice(0, 16) === pending.started.slice(0, 16) &&
      Math.round(seconds) === Math.round(pending.timeSpentSeconds) &&
      normalizeComment(commentText(entry.comment)) === normalizeComment(pending.comment);
  });
}

async function loadQueueStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load("offline-queue.json");
}

export async function getPendingWorklogs(): Promise<PendingWorklog[]> {
  const store = await loadQueueStore();
  return (await store.get<PendingWorklog[]>("queue")) || [];
}

export async function addPendingWorklog(entry: PendingInput): Promise<PendingWorklog> {
  const store = await loadQueueStore();
  const queue = (await store.get<PendingWorklog[]>("queue")) || [];
  const existing = queue.find((item) => fingerprint(item) === fingerprint(entry));
  if (existing) return existing;
  const pending: PendingWorklog = { ...entry, id: crypto.randomUUID(), status: "pending" };
  await store.set("queue", [...queue, pending]);
  await store.save();
  return pending;
}

export async function removePendingWorklog(id: string): Promise<void> {
  const store = await loadQueueStore();
  const queue = (await store.get<PendingWorklog[]>("queue")) || [];
  await store.set("queue", queue.filter((entry) => entry.id !== id));
  await store.save();
}

let activeSync: Promise<{ synced: number; failed: number }> | null = null;

async function runPendingSync(): Promise<{ synced: number; failed: number }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { load } = await import("@tauri-apps/plugin-store");
  const settings = await load("settings.json");
  const cfg = {
    baseUrl: (await settings.get<string>("baseUrl")) || "",
    email: (await settings.get<string>("email")) || "",
    apiToken: (await settings.get<string>("apiToken")) || "",
    isCloud: (await settings.get<boolean>("isCloud")) ?? true,
  };
  if (!cfg.baseUrl) return { synced: 0, failed: 0 };

  const initial = await getPendingWorklogs();
  const processedIds = new Set(initial.map((entry) => entry.id));
  const failedEntries: PendingWorklog[] = [];
  let synced = 0;

  for (const entry of initial) {
    try {
      let alreadyExists = false;
      try {
        const remote = await invoke<RemoteWorklog[]>("get_worklogs", {
          ...cfg,
          issueKey: entry.issueKey,
        });
        alreadyExists = remoteContainsPending(remote, entry);
      } catch {
        // Continue to add; a failed add keeps the item in the queue.
      }
      if (!alreadyExists) {
        await invoke("add_worklog", {
          ...cfg,
          issueKey: entry.issueKey,
          timeSpentSeconds: entry.timeSpentSeconds,
          started: entry.started,
          comment: entry.comment,
        });
      }
      synced += 1;
    } catch {
      failedEntries.push({ ...entry, status: "failed" });
    }
  }

  const latest = await getPendingWorklogs();
  const addedDuringSync = latest.filter((entry) => !processedIds.has(entry.id));
  const queueStore = await loadQueueStore();
  await queueStore.set("queue", [...failedEntries, ...addedDuringSync]);
  await queueStore.save();
  return { synced, failed: failedEntries.length };
}

export function syncPendingWorklogs(): Promise<{ synced: number; failed: number }> {
  if (activeSync) return activeSync;
  activeSync = runPendingSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}
