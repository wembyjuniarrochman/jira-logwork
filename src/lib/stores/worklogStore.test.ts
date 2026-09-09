import { describe, expect, it } from "vitest";
import { containsWorklog, type WorklogDay } from "./worklogStore";

const submitted = {
  issueKey: "JMI-261",
  hours: 1.5,
  started: "2026-09-10T09:00:00.000+0700",
};

describe("containsWorklog", () => {
  it("confirms a submitted worklog after Jira returns it", () => {
    const fetched: Record<string, WorklogDay> = {
      "2026-09-10": {
        totalHours: 1.5,
        entries: [{
          id: "123",
          issueKey: "JMI-261",
          hours: 1.5,
          timeSpentSeconds: 5400,
          started: "2026-09-10T09:00:00.000+0700",
          description: "Daily activity",
        }],
      },
    };
    expect(containsWorklog(fetched, submitted)).toBe(true);
  });

  it("keeps the optimistic worklog when Jira still returns stale data", () => {
    expect(containsWorklog({}, submitted)).toBe(false);
    expect(containsWorklog({
      "2026-09-10": {
        totalHours: 1,
        entries: [{
          issueKey: "JMI-261",
          hours: 1,
          started: "2026-09-10T09:00:00.000+0700",
          description: "Older worklog",
        }],
      },
    }, submitted)).toBe(false);
  });
});
