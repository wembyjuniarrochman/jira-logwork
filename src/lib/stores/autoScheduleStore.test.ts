import { describe, it, expect } from "vitest";
import {
  computeEligibleSlots,
  slotKey,
  slotKeyDate,
  isLegacyProcessedEntry,
  pruneProcessedSlots,
  addDaysYMD,
  dayOfWeek,
  isValidActivity,
  isValidActivityHours,
  isActivityInRange,
  filterActivitiesForDate,
  DEFAULT_AUTO_SCHEDULE_CONFIG,
  type AutoScheduleConfig,
  type AutoScheduleActivity,
  type ScheduleSlot,
} from "./autoScheduleStore";

/** Tanggal unik dari daftar slot, mempertahankan urutan. */
function datesOf(slots: ScheduleSlot[]): string[] {
  return [...new Set(slots.map((s) => s.date))];
}

const ACT: AutoScheduleActivity = {
  id: "a1",
  issueKey: "PROJ-1",
  summary: "",
  hours: 1,
  description: "",
  startTime: "09:00",
};

function cfg(over: Partial<AutoScheduleConfig> = {}): AutoScheduleConfig {
  return {
    ...DEFAULT_AUTO_SCHEDULE_CONFIG,
    enabled: true,
    activities: [ACT],
    ...over,
  };
}

const noHoliday = () => false;

describe("date helpers", () => {
  it("addDaysYMD handles month/year rollover", () => {
    expect(addDaysYMD("2026-07-20", -1)).toBe("2026-07-19");
    expect(addDaysYMD("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysYMD("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("dayOfWeek: 2026-07-20 is a Monday", () => {
    expect(dayOfWeek("2026-07-20")).toBe(1);
    expect(dayOfWeek("2026-07-18")).toBe(6); // Saturday
    expect(dayOfWeek("2026-07-19")).toBe(0); // Sunday
  });
});

describe("validation", () => {
  it("accepts 0.25-step hours in [0.25, 24]", () => {
    expect(isValidActivityHours(0.25)).toBe(true);
    expect(isValidActivityHours(1.5)).toBe(true);
    expect(isValidActivityHours(24)).toBe(true);
    expect(isValidActivityHours(0)).toBe(false);
    expect(isValidActivityHours(1.1)).toBe(false);
    expect(isValidActivityHours(25)).toBe(false);
  });

  it("requires a non-empty issue key", () => {
    expect(isValidActivity(ACT)).toBe(true);
    expect(isValidActivity({ ...ACT, issueKey: "" })).toBe(false);
    expect(isValidActivity({ ...ACT, hours: 0 })).toBe(false);
  });
});

describe("computeEligibleSlots", () => {
  const monday = "2026-07-20";

  it("returns [] when disabled or no activities", () => {
    expect(
      computeEligibleSlots({ today: monday, config: cfg({ enabled: false }), processed: [], isHoliday: noHoliday }),
    ).toEqual([]);
    expect(
      computeEligibleSlots({ today: monday, config: cfg({ activities: [] }), processed: [], isHoliday: noHoliday }),
    ).toEqual([]);
  });

  it("without catch-up, only today when it matches the schedule", () => {
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: false }),
      processed: [],
      isHoliday: noHoliday,
    });
    expect(datesOf(slots)).toEqual([monday]);
    expect(slots[0].activity.id).toBe("a1");
  });

  it("without catch-up, [] when today is not a scheduled weekday", () => {
    const sunday = "2026-07-19";
    expect(
      computeEligibleSlots({
        today: sunday,
        config: cfg({ catchUp: false }),
        processed: [],
        isHoliday: noHoliday,
      }),
    ).toEqual([]);
  });

  it("catch-up fills prior workdays (oldest first), skipping the weekend", () => {
    // today = Mon 2026-07-20, window 7 days back → Tue14..Mon20.
    // Sat18 + Sun19 are weekends → excluded by default daysOfWeek Mon–Fri.
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7 }),
      processed: [],
      isHoliday: noHoliday,
    });
    expect(datesOf(slots)).toEqual([
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-20",
    ]);
  });

  it("excludes already-processed slots", () => {
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7 }),
      processed: [
        slotKey("a1", "2026-07-15"),
        slotKey("a1", "2026-07-16"),
        slotKey("a1", "2026-07-17"),
      ],
      isHoliday: noHoliday,
    });
    expect(datesOf(slots)).toEqual(["2026-07-14", "2026-07-20"]);
  });

  it("emits one slot per activity per date", () => {
    const a1: AutoScheduleActivity = { ...ACT, id: "a1" };
    const a2: AutoScheduleActivity = { ...ACT, id: "a2", issueKey: "PROJ-2" };
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: false, activities: [a1, a2] }),
      processed: [],
      isHoliday: noHoliday,
    });
    expect(slots.map((s) => `${s.activity.id}@${s.date}`)).toEqual([
      "a1@2026-07-20",
      "a2@2026-07-20",
    ]);
  });

  it("a processed slot does not block another activity on the same date", () => {
    // Regresi: model lama menandai per-TANGGAL, sehingga kegiatan yang
    // ditambahkan setelah tanggal itu selesai tidak pernah dapat draf.
    const done: AutoScheduleActivity = { ...ACT, id: "done" };
    const added: AutoScheduleActivity = { ...ACT, id: "added", issueKey: "PROJ-9" };
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: false, activities: [done, added] }),
      processed: [slotKey("done", monday)],
      isHoliday: noHoliday,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].activity.id).toBe("added");
    expect(slots[0].date).toBe(monday);
  });

  it("skips holidays when skipHolidays is on", () => {
    const holiday = (ymd: string) => ymd === "2026-07-16";
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, skipHolidays: true }),
      processed: [],
      isHoliday: holiday,
    });
    expect(datesOf(slots)).not.toContain("2026-07-16");

    const noSkip = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, skipHolidays: false }),
      processed: [],
      isHoliday: holiday,
    });
    expect(datesOf(noSkip)).toContain("2026-07-16");
  });

  it("respects a custom daysOfWeek set", () => {
    // Only Mondays.
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, daysOfWeek: [1] }),
      processed: [],
      isHoliday: noHoliday,
    });
    expect(datesOf(slots)).toEqual(["2026-07-20"]);
  });
});

describe("slot keys + processed persistence helpers", () => {
  it("slotKey / slotKeyDate round-trip", () => {
    expect(slotKey("act-1", "2026-07-20")).toBe("act-1|2026-07-20");
    expect(slotKeyDate("act-1|2026-07-20")).toBe("2026-07-20");
    // Id yang mengandung "|" tetap terbaca karena memakai pemisah terakhir.
    expect(slotKeyDate("act|odd|2026-07-20")).toBe("2026-07-20");
  });

  it("recognises legacy date-only processed entries", () => {
    expect(isLegacyProcessedEntry("2026-07-20")).toBe(true);
    expect(isLegacyProcessedEntry("act-1|2026-07-20")).toBe(false);
    expect(isLegacyProcessedEntry("")).toBe(false);
  });

  it("pruneProcessedSlots drops slots older than the retention window", () => {
    const kept = pruneProcessedSlots(
      [
        slotKey("a1", "2026-07-20"),
        slotKey("a1", "2026-07-01"),
        slotKey("a1", "2026-01-01"),
      ],
      "2026-07-20",
      30,
    );
    expect(kept).toEqual([slotKey("a1", "2026-07-01"), slotKey("a1", "2026-07-20")]);
  });

  it("pruneProcessedSlots keeps every activity on a retained date", () => {
    // Pemangkasan berbasis tanggal, bukan jumlah entri — dua kegiatan pada
    // tanggal yang sama harus sama-sama bertahan.
    const kept = pruneProcessedSlots(
      [slotKey("a1", "2026-07-20"), slotKey("a2", "2026-07-20")],
      "2026-07-20",
      30,
    );
    expect(kept).toHaveLength(2);
  });
});

describe("isActivityInRange", () => {
  it("returns true when no date range is set (undefined)", () => {
    expect(isActivityInRange(ACT, "2026-07-20")).toBe(true);
    expect(isActivityInRange({ ...ACT, startDate: undefined, endDate: undefined }, "2026-01-01")).toBe(true);
  });

  it("returns true when date range is empty string", () => {
    expect(isActivityInRange({ ...ACT, startDate: "", endDate: "" }, "2026-07-20")).toBe(true);
  });

  it("returns false when ymd is before startDate", () => {
    expect(isActivityInRange({ ...ACT, startDate: "2026-08-01" }, "2026-07-20")).toBe(false);
  });

  it("returns true when ymd equals startDate", () => {
    expect(isActivityInRange({ ...ACT, startDate: "2026-07-20" }, "2026-07-20")).toBe(true);
  });

  it("returns false when ymd is after endDate", () => {
    expect(isActivityInRange({ ...ACT, endDate: "2026-07-15" }, "2026-07-20")).toBe(false);
  });

  it("returns true when ymd equals endDate", () => {
    expect(isActivityInRange({ ...ACT, endDate: "2026-07-20" }, "2026-07-20")).toBe(true);
  });

  it("returns true when ymd is within startDate and endDate", () => {
    const activity = { ...ACT, startDate: "2026-07-01", endDate: "2026-07-31" };
    expect(isActivityInRange(activity, "2026-07-15")).toBe(true);
    expect(isActivityInRange(activity, "2026-07-01")).toBe(true);
    expect(isActivityInRange(activity, "2026-07-31")).toBe(true);
  });

  it("returns false when ymd is outside both bounds", () => {
    const activity = { ...ACT, startDate: "2026-07-01", endDate: "2026-07-31" };
    expect(isActivityInRange(activity, "2026-06-30")).toBe(false);
    expect(isActivityInRange(activity, "2026-08-01")).toBe(false);
  });

  it("handles only startDate set (no end limit)", () => {
    const activity = { ...ACT, startDate: "2026-07-01" };
    expect(isActivityInRange(activity, "2026-06-30")).toBe(false);
    expect(isActivityInRange(activity, "2026-12-31")).toBe(true);
  });

  it("handles only endDate set (no start limit)", () => {
    const activity = { ...ACT, endDate: "2026-07-31" };
    expect(isActivityInRange(activity, "2026-01-01")).toBe(true);
    expect(isActivityInRange(activity, "2026-08-01")).toBe(false);
  });
});

describe("filterActivitiesForDate", () => {
  it("filters activities based on their individual date ranges", () => {
    const a1: AutoScheduleActivity = { ...ACT, id: "a1", startDate: "2026-07-01", endDate: "2026-07-15" };
    const a2: AutoScheduleActivity = { ...ACT, id: "a2", startDate: "2026-07-10", endDate: "2026-07-25" };
    const a3: AutoScheduleActivity = { ...ACT, id: "a3" }; // no range, always active

    const on14 = filterActivitiesForDate([a1, a2, a3], "2026-07-14");
    expect(on14.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);

    const on20 = filterActivitiesForDate([a1, a2, a3], "2026-07-20");
    expect(on20.map((a) => a.id)).toEqual(["a2", "a3"]);

    const on30 = filterActivitiesForDate([a1, a2, a3], "2026-07-30");
    expect(on30.map((a) => a.id)).toEqual(["a3"]);
  });
});

describe("computeEligibleSlots with date range", () => {
  const monday = "2026-07-20";

  it("excludes dates where all activities are out of range", () => {
    // Activity only valid Jul 18-20 (Sat-Mon), but Sat not in daysOfWeek
    const actRanged: AutoScheduleActivity = {
      ...ACT,
      startDate: "2026-07-20",
      endDate: "2026-07-20",
    };
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, activities: [actRanged] }),
      processed: [],
      isHoliday: noHoliday,
    });
    // Only 2026-07-20 is within the activity range AND a weekday
    expect(datesOf(slots)).toEqual(["2026-07-20"]);
  });

  it("an expired activity yields no slots at all", () => {
    // Kasus nyata: kegiatan berakhir 31 Agu, hari ini 7 Sep → tidak ada draf.
    const expired: AutoScheduleActivity = {
      ...ACT,
      startDate: "2026-08-03",
      endDate: "2026-08-31",
    };
    const slots = computeEligibleSlots({
      today: "2026-09-07",
      config: cfg({ catchUp: true, catchUpMaxDays: 5, activities: [expired] }),
      processed: [],
      isHoliday: noHoliday,
    });
    expect(slots).toEqual([]);
  });

  it("emits slots only for the activities in range on each date", () => {
    const a1: AutoScheduleActivity = { ...ACT, id: "a1", startDate: "2026-07-14", endDate: "2026-07-16" };
    const a2: AutoScheduleActivity = { ...ACT, id: "a2", startDate: "2026-07-20", endDate: "2026-07-20" };
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, activities: [a1, a2] }),
      processed: [],
      isHoliday: noHoliday,
    });
    // a1 covers 14,15,16 (all weekdays); a2 covers only 20
    expect(slots.map((s) => `${s.activity.id}@${s.date}`)).toEqual([
      "a1@2026-07-14",
      "a1@2026-07-15",
      "a1@2026-07-16",
      "a2@2026-07-20",
    ]);
  });

  it("activities without date range are always eligible", () => {
    const actNoRange: AutoScheduleActivity = { ...ACT }; // no startDate/endDate
    const slots = computeEligibleSlots({
      today: monday,
      config: cfg({ catchUp: true, catchUpMaxDays: 7, activities: [actNoRange] }),
      processed: [],
      isHoliday: noHoliday,
    });
    // All weekdays in the 7-day window
    expect(datesOf(slots)).toEqual([
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-20",
    ]);
  });
});
