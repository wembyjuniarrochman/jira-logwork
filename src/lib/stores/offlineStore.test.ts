import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPendingWorklog,
  isDuplicatePending,
  remoteContainsPending,
  syncPendingWorklogs,
  type PendingWorklog,
} from "./offlineStore";

const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>>();
  return {
    stores,
    invoke: vi.fn(),
    load: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, {});
      const data = stores.get(name)!;
      return {
        get: vi.fn(async (key: string) => data[key]),
        set: vi.fn(async (key: string, value: unknown) => { data[key] = value; }),
        save: vi.fn(async () => {}),
      };
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: mocks.load }));

const pending: PendingWorklog = {
  id: "queue-1",
  issueKey: "JMI-261",
  timeSpentSeconds: 3600,
  started: "2026-09-10T09:00:00.000+0700",
  comment: "Daily activity\nCoordination",
  status: "pending",
};

beforeEach(() => {
  mocks.stores.clear();
  mocks.invoke.mockReset();
  mocks.load.mockClear();
});

describe("offline worklog deduplication", () => {
  it("does not enqueue an identical submit twice", () => {
    expect(isDuplicatePending([pending], {
      issueKey: "jmi-261",
      timeSpentSeconds: 3600,
      started: "2026-09-10T09:00:45.000+0700",
      comment: "Daily activity  Coordination",
    })).toBe(true);
  });

  it("detects a worklog Jira accepted before the response was lost", () => {
    expect(remoteContainsPending([{
      time_spent_seconds: 3600,
      started: "2026-09-10T09:00:00.000+0700",
      comment: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Daily activity" }] },
          { type: "paragraph", content: [{ type: "text", text: "Coordination" }] },
        ],
      },
    }], pending)).toBe(true);
  });

  it("does not collapse different durations or start times", () => {
    expect(remoteContainsPending([{
      timeSpentSeconds: 1800,
      started: pending.started,
      comment: pending.comment,
    }], pending)).toBe(false);
  });

  it("stores an identical offline submit only once", async () => {
    const input = {
      issueKey: pending.issueKey,
      timeSpentSeconds: pending.timeSpentSeconds,
      started: pending.started,
      comment: pending.comment,
    };
    const first = await addPendingWorklog(input);
    const second = await addPendingWorklog(input);
    expect(second.id).toBe(first.id);
    expect(mocks.stores.get("offline-queue.json")?.queue).toHaveLength(1);
  });

  it("serializes concurrent queue drains", async () => {
    mocks.stores.set("settings.json", {
      baseUrl: "https://jira.example.com",
      email: "user@example.com",
      apiToken: "token",
      isCloud: true,
    });
    mocks.stores.set("offline-queue.json", { queue: [pending] });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_worklogs") return [];
      return "Worklog added";
    });

    await Promise.all([syncPendingWorklogs(), syncPendingWorklogs()]);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "add_worklog")).toHaveLength(1);
    expect(mocks.stores.get("offline-queue.json")?.queue).toEqual([]);
  });
});
