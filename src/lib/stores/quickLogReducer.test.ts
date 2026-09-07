import { describe, it, expect } from "vitest";
import {
  isValidCustomHours,
  minutesOf,
  formatDuration,
  splitDuration,
  joinDuration,
  normalizeMinutes,
  formatDurationLong,
  formatDecimalHours,
  HOURS_PER_DAY,
  MAX_MINUTES,
  PRESET_MINUTES,
} from "./quickLogReducer";

describe("isValidCustomHours", () => {
  it("menerima kelipatan 5 menit", () => {
    expect(isValidCustomHours(5 / 60)).toBe(true); // 5 menit
    expect(isValidCustomHours(0.25)).toBe(true); // 15 menit
    expect(isValidCustomHours(0.5)).toBe(true); // 30 menit
    expect(isValidCustomHours(1)).toBe(true);
    expect(isValidCustomHours(24)).toBe(true);
  });

  it("menolak durasi yang bukan kelipatan 5 menit", () => {
    expect(isValidCustomHours(1 / 60)).toBe(false); // 1 menit
    expect(isValidCustomHours(7 / 60)).toBe(false); // 7 menit
  });

  it("menolak nilai di luar rentang", () => {
    expect(isValidCustomHours(0)).toBe(false);
    expect(isValidCustomHours(-1)).toBe(false);
    expect(isValidCustomHours(24.5)).toBe(false);
  });

  it("menolak nilai non-numerik", () => {
    expect(isValidCustomHours(Number.NaN)).toBe(false);
    expect(isValidCustomHours(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("tidak tersandung pembagian float", () => {
    // 5/60 = 0.08333… yang tak pernah bulat dalam jam; validasi harus
    // bekerja dalam menit agar nilai ini tetap diterima.
    expect(isValidCustomHours(5 / 60)).toBe(true);
    expect(isValidCustomHours(0.0833333333333333)).toBe(true);
  });
});

describe("minutesOf", () => {
  it("membulatkan jam ke menit terdekat", () => {
    expect(minutesOf(5 / 60)).toBe(5);
    expect(minutesOf(0.25)).toBe(15);
    expect(minutesOf(1)).toBe(60);
    expect(minutesOf(8)).toBe(480);
  });
});

describe("formatDuration", () => {
  it("memakai menit di bawah satu jam, jam di atasnya", () => {
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(90)).toBe("1.5h");
  });
});

describe("PRESET_MINUTES", () => {
  it("semua preset lolos validasi", () => {
    // Menjaga agar daftar chip tidak pernah menawarkan nilai yang lalu
    // ditolak saat submit.
    for (const m of PRESET_MINUTES) {
      expect(isValidCustomHours(m / 60)).toBe(true);
    }
  });

  it("terurut menaik", () => {
    const sorted = [...PRESET_MINUTES].sort((a, b) => a - b);
    expect(PRESET_MINUTES).toEqual(sorted);
  });
});

describe("splitDuration / joinDuration", () => {
  it("memecah jam desimal jadi hari/jam/menit", () => {
    expect(splitDuration(1.5)).toEqual({ days: 0, hours: 1, minutes: 30 });
    expect(splitDuration(0.25)).toEqual({ days: 0, hours: 0, minutes: 15 });
    // 1 hari kerja = 8 jam, jadi 8.5 jam adalah 1 hari 30 menit.
    expect(splitDuration(8.5)).toEqual({ days: 1, hours: 0, minutes: 30 });
    expect(splitDuration(20)).toEqual({ days: 2, hours: 4, minutes: 0 });
  });

  it("memperlakukan durasi kosong/negatif sebagai nol", () => {
    expect(splitDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(splitDuration(-3)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(splitDuration(Number.NaN)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it("join membalik split tanpa kehilangan presisi", () => {
    // Ini yang paling penting: nilai bolak-balik antara satu angka jam dan
    // tiga kolom setiap kali form dibuka untuk mengedit.
    for (const minutes of [5, 15, 90, 480, 510, 1200, 1440]) {
      const hours = minutes / 60;
      const p = splitDuration(hours);
      expect(minutesOf(joinDuration(p.days, p.hours, p.minutes))).toBe(minutes);
    }
  });

  it("join mengabaikan bagian yang tidak terisi", () => {
    expect(joinDuration(0, 1, 30)).toBeCloseTo(1.5, 10);
    expect(minutesOf(joinDuration(1, 0, 0))).toBe(HOURS_PER_DAY * 60);
    expect(minutesOf(joinDuration(Number.NaN, 2, Number.NaN))).toBe(120);
  });
});

describe("normalizeMinutes", () => {
  it("membulatkan ke kelipatan 5 menit terdekat", () => {
    expect(normalizeMinutes(39)).toBe(40);
    expect(normalizeMinutes(37)).toBe(35);
    expect(normalizeMinutes(30)).toBe(30);
  });

  it("menjepit ke rentang yang sah", () => {
    // Di bawah satuan terkecil dinaikkan, bukan dijadikan nol — user yang
    // mengetik "2" jelas bermaksud mencatat sesuatu.
    expect(normalizeMinutes(2)).toBe(5);
    expect(normalizeMinutes(99999)).toBe(MAX_MINUTES);
  });

  it("nol dan nilai tak sah tetap nol", () => {
    expect(normalizeMinutes(0)).toBe(0);
    expect(normalizeMinutes(-10)).toBe(0);
    expect(normalizeMinutes(Number.NaN)).toBe(0);
  });

  it("hasilnya selalu lolos validasi submit", () => {
    // Jaminan inti: apa pun yang diketik user, angka yang tampil setelah
    // normalisasi tidak boleh ditolak saat submit.
    for (const raw of [1, 7, 39, 61, 90, 599, 1441, 99999]) {
      expect(isValidCustomHours(normalizeMinutes(raw) / 60)).toBe(true);
    }
  });
});

describe("normalisasi berjenjang antar satuan", () => {
  it("kelebihan menit naik jadi jam", () => {
    expect(splitDuration(normalizeMinutes(90) / 60)).toEqual({
      days: 0,
      hours: 1,
      minutes: 30,
    });
  });

  it("kelebihan jam naik jadi hari kerja", () => {
    const tenHours = 10 * 60;
    expect(splitDuration(normalizeMinutes(tenHours) / 60)).toEqual({
      days: 1,
      hours: 2,
      minutes: 0,
    });
  });

  it("gabungan menit besar menyebar ke hari dan jam", () => {
    // 1000 menit = 16j40m = 2 hari kerja + 40 menit.
    expect(splitDuration(normalizeMinutes(1000) / 60)).toEqual({
      days: 2,
      hours: 0,
      minutes: 40,
    });
  });
});

describe("formatDurationLong", () => {
  it("melewati bagian yang bernilai nol", () => {
    expect(formatDurationLong(30)).toBe("30 menit");
    expect(formatDurationLong(60)).toBe("1 jam");
    expect(formatDurationLong(90)).toBe("1 jam 30 menit");
    // 8 jam = 1 hari kerja, jadi bukan "0 hari 8 jam".
    expect(formatDurationLong(480)).toBe("1 hari");
    // Label satuan bisa diganti, agar kalimat terjemahan tidak kebocoran
    // satuan berbahasa Indonesia.
    expect(
      formatDurationLong(510, { day: "day", hour: "h", minute: "min" }),
    ).toBe("1 day 30 min");
    expect(formatDurationLong(510)).toBe("1 hari 30 menit");
    expect(formatDurationLong(630)).toBe("1 hari 2 jam 30 menit");
  });

  it("durasi nol menghasilkan string kosong", () => {
    // Pemanggil memakai ini untuk menyembunyikan label total.
    expect(formatDurationLong(0)).toBe("");
    expect(formatDurationLong(-5)).toBe("");
    expect(formatDurationLong(Number.NaN)).toBe("");
  });
});

describe("formatDecimalHours", () => {
  it("membuang nol di belakang", () => {
    expect(formatDecimalHours(480)).toBe("8h");
    expect(formatDecimalHours(90)).toBe("1.5h");
    expect(formatDecimalHours(15)).toBe("0.25h");
    expect(formatDecimalHours(5)).toBe("0.08h");
  });

  it("durasi nol menghasilkan string kosong", () => {
    expect(formatDecimalHours(0)).toBe("");
    expect(formatDecimalHours(-10)).toBe("");
    expect(formatDecimalHours(Number.NaN)).toBe("");
  });
});
