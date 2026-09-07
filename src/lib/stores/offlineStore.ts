export interface PendingWorklog { id: string; issueKey: string; timeSpentSeconds: number; started: string; comment: string; status: "pending"|"failed"; }

export async function getPendingWorklogs(): Promise<PendingWorklog[]> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("offline-queue.json");
  return (await store.get<PendingWorklog[]>("queue")) || [];
}

export async function addPendingWorklog(entry: Omit<PendingWorklog, "id"|"status">): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("offline-queue.json");
  const queue = (await store.get<PendingWorklog[]>("queue")) || [];
  queue.push({ ...entry, id: crypto.randomUUID(), status: "pending" });
  await store.set("queue", queue); await store.save();
}

export async function removePendingWorklog(id: string): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("offline-queue.json");
  const queue = (await store.get<PendingWorklog[]>("queue")) || [];
  await store.set("queue", queue.filter(w => w.id !== id)); await store.save();
}

export async function syncPendingWorklogs(): Promise<{ synced: number; failed: number }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json");
  const cfg = { baseUrl: (await store.get<string>("baseUrl"))||"", email: (await store.get<string>("email"))||"", apiToken: (await store.get<string>("apiToken"))||"", isCloud: (await store.get<boolean>("isCloud"))??true };
  if (!cfg.baseUrl) return { synced: 0, failed: 0 };
  const queue = await getPendingWorklogs();
  let synced = 0, failed = 0;
  for (const entry of queue) {
    try { await invoke("add_worklog", { ...cfg, issueKey: entry.issueKey, timeSpentSeconds: entry.timeSpentSeconds, started: entry.started, comment: entry.comment }); await removePendingWorklog(entry.id); synced++; }
    catch { failed++; }
  }
  return { synced, failed };
}
