import { describe, expect, it } from "vitest";
import {
  preferEpicRoots,
  requiresProjectFanout,
  type SearchResult,
} from "./searchStore";

describe("preferEpicRoots", () => {
  it("uses matching Epics as the only search roots", () => {
    const rows: SearchResult[] = [
      { key: "EVS-1178", summary: "[IRQ-1460] Epic", issueType: "Epic" },
      { key: "EVS-1179", summary: "[IRQ-1460] Task", issueType: "Task" },
      { key: "EVS-1180", summary: "[IRQ-1460] Sub-task", issueType: "Sub-task" },
    ];

    expect(preferEpicRoots(rows)).toEqual([rows[0]]);
  });

  it("keeps task-only results selectable", () => {
    const rows: SearchResult[] = [
      { key: "EVS-1179", summary: "Task", issueType: "Task" },
      { key: "EVS-1180", summary: "Sub-task", issueType: "Sub-task" },
    ];

    expect(preferEpicRoots(rows)).toEqual(rows);
  });
});

describe("requiresProjectFanout", () => {
  it("fans out numeric and punctuation reference searches", () => {
    expect(requiresProjectFanout("1460")).toBe(true);
    expect(requiresProjectFanout("[IRQ-1460]")).toBe(true);
    expect(requiresProjectFanout("Daily; sync")).toBe(true);
  });

  it("keeps normal text searches on the global Jira endpoint", () => {
    expect(requiresProjectFanout("daily sync")).toBe(false);
    expect(requiresProjectFanout("   ")).toBe(false);
  });
});
