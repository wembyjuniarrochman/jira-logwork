import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  jiraStarted,
  validateWorkspaceSettings,
} from "./settingsStore";

describe("workspace working hours", () => {
  it("uses the configured workday start for new Jira worklogs", () => {
    expect(jiraStarted("2026-09-10", "08:30")).toBe("2026-09-10T08:30:00.000+0000");
    expect(jiraStarted("2026-09-10", "invalid")).toContain("T09:00:00.000");
  });

  it("requires the workday to end after it starts", () => {
    expect(validateWorkspaceSettings(DEFAULT_WORKSPACE_SETTINGS).valid).toBe(true);
    const invalid = validateWorkspaceSettings({
      ...DEFAULT_WORKSPACE_SETTINGS,
      workdayStart: "18:00",
      workdayEnd: "09:00",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.workdayHours).toBeTruthy();
  });
});
