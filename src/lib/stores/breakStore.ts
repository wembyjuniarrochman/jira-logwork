/**
 * breakStore
 *
 * Konfigurasi + logika murni untuk **jam istirahat**.
 *
 * Sebelumnya jam istirahat hanya hiasan di `CalendarGrid` (12:00–13:00,
 * di-hardcode, Jumat sampai 13:30) dan tidak memengaruhi apa pun.
 *
 * Modelnya sekarang: durasi yang dicatat adalah **jam kerja**, dan jam
 * istirahat tidak mengurangi angka itu — ia hanya menggeser jam selesai.
 * Mulai 09:00 selama 8 jam kerja berarti selesai pukul 18:00, digambar
 * sebagai dua segmen dengan jam istirahat bersih di antaranya. Jira tetap
 * menerima 8 jam, yang memang jumlah kerja sebenarnya.
 *
 * Karena nilainya kini menentukan tampilan kalender, jam istirahat
 * dipindahkan ke setelan yang bisa diubah user, dan seluruh perhitungannya
 * dipisah ke fungsi murni di sini supaya bisa diuji tanpa DOM maupun Jira.
 */

const SETTINGS_FILE = "settings.json";
const KEY_ENABLED = "breakEnabled";
const KEY_START = "breakStart";
const KEY_END = "breakEnd";
const KEY_FRIDAY_END = "breakFridayEnd";

export interface BreakConfig {
  /** Saat false, blok tidak dipecah dan pita istirahat disembunyikan. */
  enabled: boolean;
  /** "HH:mm". */
  start: string;
  /** "HH:mm". */
  end: string;
  /**
   * "HH:mm" khusus Jumat, atau "" bila sama dengan `end`. Banyak kantor di
   * Indonesia memberi jeda Jumat lebih panjang untuk salat Jumat.
   */
  fridayEnd: string;
}

export const DEFAULT_BREAK_CONFIG: BreakConfig = {
  enabled: true,
  start: "12:00",
  end: "13:00",
  fridayEnd: "13:30",
};

// --- Helper murni ---

/** Pure: "HH:mm" → menit sejak tengah malam; null bila formatnya tidak sah. */
export function parseHHmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Pure: menit sejak tengah malam → "HH:mm". */
export function formatHHmm(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Pure: rentang istirahat untuk `dayOfWeek` (0=Minggu … 6=Sabtu), dalam
 * menit. `null` bila nonaktif, akhir pekan, atau konfigurasinya tidak sah.
 *
 * Akhir pekan selalu dikecualikan: mencatat kerja di hari Sabtu tidak
 * seharusnya kehilangan satu jam karena jadwal istirahat hari kerja.
 */
export function breakRangeFor(
  config: BreakConfig,
  dayOfWeek: number,
): { start: number; end: number } | null {
  if (!config.enabled) return null;
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const start = parseHHmm(config.start);
  if (start === null) return null;

  const isFriday = dayOfWeek === 5;
  const endRaw =
    isFriday && config.fridayEnd.trim() !== "" ? config.fridayEnd : config.end;
  const end = parseHHmm(endRaw);
  if (end === null || end <= start) return null;

  return { start, end };
}

/**
 * Pure: berapa menit dari rentang [startMin, startMin + durationMin)
 * bertumpang tindih dengan jam istirahat hari itu.
 *
 * Mengembalikan 0 saat tidak ada irisan — termasuk saat worklog berakhir
 * tepat di awal istirahat atau mulai tepat di akhirnya, karena rentangnya
 * setengah terbuka.
 */
export function breakOverlapMinutes(
  config: BreakConfig,
  dayOfWeek: number,
  startMin: number,
  durationMin: number,
): number {
  if (!Number.isFinite(startMin) || !Number.isFinite(durationMin)) return 0;
  if (durationMin <= 0) return 0;

  const range = breakRangeFor(config, dayOfWeek);
  if (!range) return 0;

  const endMin = startMin + durationMin;
  const overlap = Math.min(endMin, range.end) - Math.max(startMin, range.start);
  return overlap > 0 ? overlap : 0;
}


export interface WorkSegment {
  /** Menit sejak tengah malam. */
  start: number;
  end: number;
}

/**
 * Pure: tata letak `workMin` menit kerja pada timeline, **melompati** jam
 * istirahat.
 *
 * `workMin` adalah jam kerja murni, tanpa istirahat. Menggambarnya sebagai
 * satu balok utuh akan menindih jam istirahat dan membuat ujungnya jatuh
 * lebih awal dari kenyataan. Mengalirkannya melewati jeda menjaga luas yang
 * tergambar tetap sama dengan durasi tersimpan, jam istirahatnya bersih,
 * dan ujungnya jatuh di jam yang benar.
 *
 * Contoh: mulai 09:00 dengan 8 jam kerja dan istirahat 12:00–13:00
 * menghasilkan 09:00–12:00 lalu 13:00–18:00.
 */
export function layoutAroundBreak(
  startMin: number,
  workMin: number,
  range: { start: number; end: number } | null,
): WorkSegment[] {
  const whole = [{ start: startMin, end: startMin + workMin }];
  if (!range || workMin <= 0) return whole;

  // Selesai sebelum istirahat mulai, atau baru mulai setelah selesai.
  if (startMin + workMin <= range.start) return whole;
  if (startMin >= range.end) return whole;

  // Mulai di tengah istirahat: geser seluruhnya ke setelah jeda.
  if (startMin >= range.start) {
    return [{ start: range.end, end: range.end + workMin }];
  }

  // Melintasi jeda: pecah jadi dua segmen.
  const before = range.start - startMin;
  const after = workMin - before;
  return [
    { start: startMin, end: range.start },
    { start: range.end, end: range.end + after },
  ];
}

// --- Persistensi ---

/** Muat konfigurasi istirahat dari `settings.json`; default aman per key. */
export async function loadBreakConfig(): Promise<BreakConfig> {
  const d = DEFAULT_BREAK_CONFIG;
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);

    const enabledRaw = await store.get<boolean>(KEY_ENABLED);
    const startRaw = await store.get<string>(KEY_START);
    const endRaw = await store.get<string>(KEY_END);
    const fridayRaw = await store.get<string>(KEY_FRIDAY_END);

    return {
      enabled: typeof enabledRaw === "boolean" ? enabledRaw : d.enabled,
      start: parseHHmm(startRaw ?? "") !== null ? (startRaw as string) : d.start,
      end: parseHHmm(endRaw ?? "") !== null ? (endRaw as string) : d.end,
      fridayEnd:
        typeof fridayRaw === "string" &&
        (fridayRaw.trim() === "" || parseHHmm(fridayRaw) !== null)
          ? fridayRaw
          : d.fridayEnd,
    };
  } catch {
    return { ...DEFAULT_BREAK_CONFIG };
  }
}

/** Persist konfigurasi istirahat. */
export async function saveBreakConfig(config: BreakConfig): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_ENABLED, config.enabled);
  await store.set(KEY_START, config.start);
  await store.set(KEY_END, config.end);
  await store.set(KEY_FRIDAY_END, config.fridayEnd);
  await store.save();
}
