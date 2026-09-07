import { describe, it, expect } from "vitest";
import {
  prependCapped,
  toCsv,
  makeAuditEntry,
  type AuditEntry,
} from "./auditLogStore";

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: over.id ?? "x",
    timestamp: over.timestamp ?? "2026-07-20T10:00:00.000Z",
    action: over.action ?? "add",
    source: over.source ?? "manual",
    status: over.status ?? "success",
    issueKey: over.issueKey,
    date: over.date,
    hours: over.hours,
    message: over.message,
  };
}

describe("makeAuditEntry", () => {
  it("fills id + timestamp when missing", () => {
    const e = makeAuditEntry({ action: "add", source: "auto", status: "success" });
    expect(e.id).toBeTruthy();
    expect(e.timestamp).toBeTruthy();
    expect(e.action).toBe("add");
    expect(e.source).toBe("auto");
  });

  it("preserves provided id + timestamp", () => {
    const e = makeAuditEntry({
      id: "fixed",
      timestamp: "2026-01-01T00:00:00.000Z",
      action: "delete",
      source: "manual",
      status: "failed",
    });
    expect(e.id).toBe("fixed");
    expect(e.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("prependCapped", () => {
  it("puts newest additions first (reversed) ahead of existing", () => {
    const existing = [entry({ id: "old" })];
    const additions = [entry({ id: "a1" }), entry({ id: "a2" })];
    const out = prependCapped(existing, additions);
    // additions given chronologically → newest (a2) first
    expect(out.map((e) => e.id)).toEqual(["a2", "a1", "old"]);
  });

  it("caps to max, keeping the most recent", () => {
    const existing = Array.from({ length: 5 }, (_, i) => entry({ id: `e${i}` }));
    const additions = [entry({ id: "new" })];
    const out = prependCapped(existing, additions, 3);
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe("new");
  });

  it("returns existing unchanged when no additions", () => {
    const existing = [entry({ id: "e" })];
    expect(prependCapped(existing, [])).toEqual(existing);
  });
});

describe("toCsv", () => {
  it("emits a header row plus one row per entry", () => {
    const csv = toCsv([
      entry({ issueKey: "PROJ-1", date: "2026-07-20", hours: 1, status: "success" }),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "timestamp,action,source,status,issueKey,date,hours,message",
    );
    expect(lines[1]).toContain("PROJ-1");
    expect(lines[1]).toContain("success");
  });

  it("escapes commas, quotes and newlines in messages", () => {
    const csv = toCsv([
      entry({ message: 'boom, "quoted"\nline2', status: "failed" }),
    ]);
    // The message cell must be quoted and inner quotes doubled.
    expect(csv).toContain('"boom, ""quoted""');
  });

  it("leaves empty cells for undefined fields", () => {
    const csv = toCsv([entry({ issueKey: undefined, hours: undefined })]);
    const row = csv.split("\n")[1];
    // action=add,source=manual,status=success present; issueKey/hours empty.
    expect(row.startsWith("2026-07-20T10:00:00.000Z,add,manual,success,,,,")).toBe(true);
  });
});
