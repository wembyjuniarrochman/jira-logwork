import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import WorkspaceHeader from "./WorkspaceHeader.svelte";
import { setLang } from "../stores/i18n.svelte";

afterEach(cleanup);

function props() {
  setLang("en");
  return {
    displayName: "Test User", email: "test@example.com",
    onOpenSettings: vi.fn(), onOpenAuditLog: vi.fn(), onLogout: vi.fn(), onSync: vi.fn(),
  };
}

describe("manual worklog sync", () => {
  it("offers Sync in the header and calls the refresh action", async () => {
    const handlers = props();
    render(WorkspaceHeader, { props: handlers });
    await fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
  });

  it("shows progress and disables repeated requests while syncing", () => {
    render(WorkspaceHeader, { props: { ...props(), isSyncing: true } });
    const button = screen.getByRole("button", { name: "Syncing…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("disables sync before credentials and initial loading are ready", () => {
    render(WorkspaceHeader, { props: { ...props(), syncDisabled: true } });
    expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();
  });

  it("shows the latest successful Jira sync time", () => {
    render(WorkspaceHeader, { props: {
      ...props(),
      lastSyncedAt: new Date(2026, 8, 10, 14, 35).getTime(),
    } });
    expect(screen.getByText(/Last:.*14:35/)).toBeInTheDocument();
  });
});
