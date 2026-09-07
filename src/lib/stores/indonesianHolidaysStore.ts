/**
 * Indonesian national holidays (Libur Nasional) — *excluding* joint holidays (Cuti Bersama).
 *
 * Source: Joint Decree (SKB) of 3 Ministers.
 *
 * Years covered: 2024–2027. 2024-2026 dates are based on official decrees.
 * 2027 dates are estimates/official where available and may be updated.
 */

export interface IndonesianHoliday {
  /** YYYY-MM-DD (local time). */
  date: string;
  /** Nama libur dalam Bahasa Indonesia. */
  name: string;
  /**
   * Sumber libur:
   *   - "national": libur nasional resmi (SKB 3 Menteri)
   */
  kind: "national";
}

const HOLIDAYS_RAW: IndonesianHoliday[] = [
  // --- 2024 ---
  { date: "2024-01-01", name: "Tahun Baru 2024 Masehi", kind: "national" },
  {
    date: "2024-02-08",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2024-02-10",
    name: "Tahun Baru Imlek 2575 Kongzili",
    kind: "national",
  },
  {
    date: "2024-02-14",
    name: "Hari Pemungutan Suara Pemilu 2024",
    kind: "national",
  },
  {
    date: "2024-03-11",
    name: "Hari Suci Nyepi Tahun Baru Saka 1946",
    kind: "national",
  },
  { date: "2024-03-29", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2024-03-31", name: "Hari Paskah", kind: "national" },
  { date: "2024-04-10", name: "Hari Raya Idul Fitri 1445 H", kind: "national" },
  { date: "2024-04-11", name: "Hari Raya Idul Fitri 1445 H", kind: "national" },
  { date: "2024-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2024-05-09", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2024-05-23", name: "Hari Raya Waisak 2568 BE", kind: "national" },
  { date: "2024-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  { date: "2024-06-17", name: "Hari Raya Idul Adha 1445 H", kind: "national" },
  { date: "2024-07-07", name: "Tahun Baru Islam 1446 H", kind: "national" },
  { date: "2024-08-17", name: "Hari Kemerdekaan RI", kind: "national" },
  { date: "2024-09-16", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2024-12-25", name: "Hari Raya Natal", kind: "national" },

  // --- 2025 ---
  { date: "2025-01-01", name: "Tahun Baru 2025 Masehi", kind: "national" },
  {
    date: "2025-01-27",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2025-01-29",
    name: "Tahun Baru Imlek 2576 Kongzili",
    kind: "national",
  },
  {
    date: "2025-03-29",
    name: "Hari Suci Nyepi Tahun Baru Saka 1947",
    kind: "national",
  },
  { date: "2025-03-31", name: "Hari Raya Idul Fitri 1446 H", kind: "national" },
  { date: "2025-04-01", name: "Hari Raya Idul Fitri 1446 H", kind: "national" },
  { date: "2025-04-18", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2025-04-20", name: "Hari Paskah", kind: "national" },
  { date: "2025-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2025-05-12", name: "Hari Raya Waisak 2569 BE", kind: "national" },
  { date: "2025-05-29", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2025-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  { date: "2025-06-06", name: "Hari Raya Idul Adha 1446 H", kind: "national" },
  { date: "2025-06-27", name: "Tahun Baru Islam 1447 H", kind: "national" },
  { date: "2025-08-17", name: "Hari Kemerdekaan RI", kind: "national" },
  { date: "2025-09-05", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2025-12-25", name: "Hari Raya Natal", kind: "national" },

  // --- 2026 ---
  { date: "2026-01-01", name: "Tahun Baru 2026 Masehi", kind: "national" },
  {
    date: "2026-01-16",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2026-02-17",
    name: "Tahun Baru Imlek 2577 Kongzili",
    kind: "national",
  },
  {
    date: "2026-03-19",
    name: "Hari Suci Nyepi Tahun Baru Saka 1948",
    kind: "national",
  },
  { date: "2026-03-21", name: "Hari Raya Idul Fitri 1447 H", kind: "national" },
  { date: "2026-03-22", name: "Hari Raya Idul Fitri 1447 H", kind: "national" },
  { date: "2026-04-03", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2026-04-05", name: "Hari Paskah", kind: "national" },
  { date: "2026-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2026-05-14", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2026-05-27", name: "Hari Raya Idul Adha 1447 H", kind: "national" },
  { date: "2026-05-31", name: "Hari Raya Waisak 2570 BE", kind: "national" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  { date: "2026-06-16", name: "Tahun Baru Islam 1448 H", kind: "national" },
  { date: "2026-08-17", name: "Hari Kemerdekaan RI", kind: "national" },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2026-12-25", name: "Hari Raya Natal", kind: "national" },

  // --- 2027 ---
  { date: "2027-01-01", name: "Tahun Baru 2027 Masehi", kind: "national" },
  {
    date: "2027-01-05",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2027-02-06",
    name: "Tahun Baru Imlek 2578 Kongzili",
    kind: "national",
  },
  { date: "2027-03-10", name: "Hari Raya Idul Fitri 1448 H", kind: "national" },
  { date: "2027-03-11", name: "Hari Raya Idul Fitri 1448 H", kind: "national" },
  { date: "2027-03-26", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2027-03-28", name: "Hari Paskah", kind: "national" },
  { date: "2027-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2027-05-06", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2027-05-16", name: "Hari Raya Waisak 2571 BE", kind: "national" },
  { date: "2027-05-17", name: "Hari Raya Idul Adha 1448 H", kind: "national" },
  { date: "2027-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  { date: "2027-06-06", name: "Tahun Baru Islam 1449 H", kind: "national" },
  { date: "2027-08-15", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2027-08-17", name: "Hari Kemerdekaan RI", kind: "national" },
  { date: "2027-12-25", name: "Hari Raya Natal", kind: "national" },
  {
    date: "2027-12-26",
    name: "Isra Mikraj Nabi Muhammad SAW (1449 H)",
    kind: "national",
  },
];

const HOLIDAY_MAP: Record<string, IndonesianHoliday> = (() => {
  const m: Record<string, IndonesianHoliday> = {};
  for (const h of HOLIDAYS_RAW) m[h.date] = h;
  return m;
})();

/**
 * Pure: kembalikan informasi libur untuk `ymd` (YYYY-MM-DD), atau `null`
 * kalau tanggal itu bukan hari libur nasional.
 */
export function getHoliday(ymd: string): IndonesianHoliday | null {
  return HOLIDAY_MAP[ymd] ?? null;
}

/** Pure: true iff `ymd` adalah hari libur nasional resmi. */
export function isHoliday(ymd: string): boolean {
  return HOLIDAY_MAP[ymd] !== undefined;
}

/**
 * Pure: hitung hari libur nasional dalam rentang `[startYMD, endYMD]` (inclusive),
 * dengan opsi `excludeWeekends` (default true).
 */
export function countHolidaysInRange(
  startYMD: string,
  endYMD: string,
  excludeWeekends: boolean = true,
): number {
  if (!startYMD || !endYMD || startYMD > endYMD) return 0;
  let count = 0;
  const start = new Date(startYMD);
  const end = new Date(endYMD);
  const cur = new Date(start);

  while (cur <= end) {
    const ymd = cur.toISOString().split("T")[0];
    if (isHoliday(ymd)) {
      const dow = cur.getDay();
      if (!excludeWeekends || (dow !== 0 && dow !== 6)) {
        count++;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Pure: hitung jumlah hari kerja efektif (Senin–Jumat dikurangi libur nasional)
 * dalam rentang `[startYMD, endYMD]` inclusive.
 */
export function countWorkdaysInRange(startYMD: string, endYMD: string): number {
  if (!startYMD || !endYMD || startYMD > endYMD) return 0;
  let count = 0;
  const start = new Date(startYMD);
  const end = new Date(endYMD);
  const cur = new Date(start);

  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const ymd = cur.toISOString().split("T")[0];
      if (!isHoliday(ymd)) count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
