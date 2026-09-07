import { describe, it, expect } from "vitest";
import {
  parseHHmm,
  formatHHmm,
  breakRangeFor,
  breakOverlapMinutes,
  layoutAroundBreak,
  DEFAULT_BREAK_CONFIG,
  type BreakConfig,
} from "./breakStore";

const cfg = (over: Partial<BreakConfig> = {}): BreakConfig => ({
  ...DEFAULT_BREAK_CONFIG,
  ...over,
});

// Hari: 1=Senin … 5=Jumat, 0=Minggu, 6=Sabtu.
const MON = 1;
const FRI = 5;
const SAT = 6;

describe("parseHHmm / formatHHmm", () => {
  it("mengurai jam yang sah", () => {
    expect(parseHHmm("00:00")).toBe(0);
    expect(parseHHmm("12:00")).toBe(720);
    expect(parseHHmm("13:30")).toBe(810);
    expect(parseHHmm("9:05")).toBe(545);
  });

  it("menolak format yang tidak sah", () => {
    expect(parseHHmm("")).toBeNull();
    expect(parseHHmm("24:00")).toBeNull();
    expect(parseHHmm("12:60")).toBeNull();
    expect(parseHHmm("abc")).toBeNull();
  });

  it("format membalik parse", () => {
    for (const t of ["00:00", "09:05", "12:00", "13:30", "23:59"]) {
      expect(formatHHmm(parseHHmm(t) as number)).toBe(
        t.padStart(5, "0"),
      );
    }
  });
});

describe("breakRangeFor", () => {
  it("mengembalikan rentang pada hari kerja", () => {
    expect(breakRangeFor(cfg(), MON)).toEqual({ start: 720, end: 780 });
  });

  it("memakai jam Jumat saat diisi", () => {
    expect(breakRangeFor(cfg(), FRI)).toEqual({ start: 720, end: 810 });
  });

  it("jatuh ke jam biasa saat Jumat dikosongkan", () => {
    expect(breakRangeFor(cfg({ fridayEnd: "" }), FRI)).toEqual({
      start: 720,
      end: 780,
    });
  });

  it("tidak ada istirahat di akhir pekan", () => {
    // Kerja di hari Sabtu tidak seharusnya kehilangan sejam karena jadwal
    // istirahat hari kerja.
    expect(breakRangeFor(cfg(), SAT)).toBeNull();
    expect(breakRangeFor(cfg(), 0)).toBeNull();
  });

  it("null saat nonaktif atau konfigurasi tidak sah", () => {
    expect(breakRangeFor(cfg({ enabled: false }), MON)).toBeNull();
    expect(breakRangeFor(cfg({ start: "oops" }), MON)).toBeNull();
    // Akhir sebelum mulai bukan rentang yang bermakna.
    expect(breakRangeFor(cfg({ start: "13:00", end: "12:00" }), MON)).toBeNull();
  });
});

describe("breakOverlapMinutes", () => {
  const c = cfg(); // 12:00–13:00

  it("menghitung irisan penuh", () => {
    // 09:00 selama 8 jam → 09:00–17:00, melewati seluruh jam istirahat.
    expect(breakOverlapMinutes(c, MON, 9 * 60, 8 * 60)).toBe(60);
  });

  it("menghitung irisan sebagian", () => {
    // 11:30 selama 1 jam → 11:30–12:30, beririsan 30 menit.
    expect(breakOverlapMinutes(c, MON, 11 * 60 + 30, 60)).toBe(30);
    // 12:30 selama 1 jam → 12:30–13:30, beririsan 30 menit.
    expect(breakOverlapMinutes(c, MON, 12 * 60 + 30, 60)).toBe(30);
  });

  it("nol saat hanya bersentuhan di tepi", () => {
    // Berakhir tepat saat istirahat mulai.
    expect(breakOverlapMinutes(c, MON, 11 * 60, 60)).toBe(0);
    // Mulai tepat saat istirahat selesai.
    expect(breakOverlapMinutes(c, MON, 13 * 60, 60)).toBe(0);
  });

  it("nol saat sama sekali di luar", () => {
    expect(breakOverlapMinutes(c, MON, 9 * 60, 60)).toBe(0);
    expect(breakOverlapMinutes(c, MON, 15 * 60, 120)).toBe(0);
  });

  it("nol untuk durasi tidak sah atau hari libur", () => {
    expect(breakOverlapMinutes(c, MON, 9 * 60, 0)).toBe(0);
    expect(breakOverlapMinutes(c, MON, 9 * 60, -60)).toBe(0);
    expect(breakOverlapMinutes(c, SAT, 9 * 60, 8 * 60)).toBe(0);
  });
});

describe("layoutAroundBreak", () => {
  const range = { start: 12 * 60, end: 13 * 60 };

  it("memecah kerja yang melintasi jeda", () => {
    // 09:00 + 7 jam kerja -> 09:00–12:00 lalu 13:00–17:00.
    expect(layoutAroundBreak(9 * 60, 7 * 60, range)).toEqual([
      { start: 540, end: 720 },
      { start: 780, end: 1020 },
    ]);
  });

  it("luas tergambar tetap sama dengan durasi tersimpan", () => {
    // Ini jaminan intinya: memecah blok tidak boleh menambah atau
    // mengurangi jam yang terlihat.
    for (const [start, work] of [
      [9 * 60, 7 * 60],
      [11 * 60, 120],
      [8 * 60, 30],
      [13 * 60, 180],
    ]) {
      const total = layoutAroundBreak(start, work, range).reduce(
        (sum, s) => sum + (s.end - s.start),
        0,
      );
      expect(total).toBe(work);
    }
  });

  it("membiarkan utuh saat tidak menyentuh jeda", () => {
    expect(layoutAroundBreak(9 * 60, 120, range)).toEqual([
      { start: 540, end: 660 },
    ]);
    expect(layoutAroundBreak(14 * 60, 60, range)).toEqual([
      { start: 840, end: 900 },
    ]);
  });

  it("berhenti tepat di tepi tanpa memecah", () => {
    // Berakhir persis saat jeda mulai.
    expect(layoutAroundBreak(11 * 60, 60, range)).toEqual([
      { start: 660, end: 720 },
    ]);
  });

  it("menggeser kerja yang dimulai di tengah jeda", () => {
    expect(layoutAroundBreak(12 * 60 + 30, 60, range)).toEqual([
      { start: 780, end: 840 },
    ]);
  });

  it("tanpa jeda, selalu satu segmen", () => {
    expect(layoutAroundBreak(9 * 60, 8 * 60, null)).toEqual([
      { start: 540, end: 1020 },
    ]);
  });
});
