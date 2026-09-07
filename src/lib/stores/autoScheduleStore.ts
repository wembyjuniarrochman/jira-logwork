/**
 * autoScheduleStore
 *
 * Konfigurasi + logika murni untuk fitur **Penjadwalan Otomatis** (draf
 * kegiatan berulang setiap hari kerja).
 *
 * Model: scheduler berjalan di dalam app (saat app dibuka / selama terbuka).
 * Untuk tiap hari kerja yang cocok jadwal, app membuat **draf** untuk setiap
 * kegiatan yang dikonfigurasi — TIDAK langsung dikirim ke Jira. Draf tampil
 * di kalender Workspace agar user bisa memeriksa / mengubah / menghapusnya
 * dulu, lalu dikirim sekaligus lewat tombol "Submit changes".
 *
 * Dedup dilakukan per **slot** = pasangan (kegiatan, tanggal), bukan per
 * tanggal. Ini penting: menandai seluruh tanggal sebagai selesai akan
 * mengunci kegiatan yang ditambahkan belakangan — draf-nya tidak akan pernah
 * dibuat untuk tanggal itu. Sebuah slot ditandai processed saat draf-nya
 * disubmit, dibuang user, atau saat worklog serupa sudah ada di Jira.
 * `processed` dipersist agar draf tidak digenerate dobel walau app dibuka
 * berkali-kali.
 *
 * Semua persistensi memakai `settings.json` (Tauri store), sama seperti
 * `settingsStore`.
 */

// --- Types ---

export interface AutoScheduleActivity {
  /** Stable id lokal untuk keying di UI (bukan id worklog Jira). */
  id: string;
  issueKey: string;
  /** Ringkasan issue — hanya untuk tampilan; opsional. */
  summary: string;
  /** Durasi dalam jam (0.25–24). */
  hours: number;
  /** Komentar worklog (plain / wiki-markup). */
  description: string;
  /** Jam mulai "HH:mm" (default "09:00"). */
  startTime: string;
  /**
   * Tanggal mulai berlaku (YYYY-MM-DD, inklusif). Opsional — jika kosong/undefined,
   * kegiatan berlaku tanpa batas awal.
   */
  startDate?: string;
  /**
   * Tanggal selesai berlaku (YYYY-MM-DD, inklusif). Opsional — jika kosong/undefined,
   * kegiatan berlaku tanpa batas akhir.
   */
  endDate?: string;
}

export interface AutoScheduleConfig {
  enabled: boolean;
  activities: AutoScheduleActivity[];
  /** Hari berlaku, 0=Minggu … 6=Sabtu. Default Sen–Jum. */
  daysOfWeek: number[];
  /** Lewati hari libur nasional (pakai indonesianHolidaysStore). */
  skipHolidays: boolean;
  /** Isi juga hari kerja yang terlewat sejak terakhir app dibuka. */
  catchUp: boolean;
  /** Batas jumlah hari ke belakang yang di-catch-up (termasuk hari ini). */
  catchUpMaxDays: number;
}

// --- Defaults ---

export const DEFAULT_AUTO_SCHEDULE_CONFIG: AutoScheduleConfig = {
  enabled: false,
  activities: [],
  daysOfWeek: [1, 2, 3, 4, 5],
  skipHolidays: true,
  catchUp: true,
  catchUpMaxDays: 7,
};

/** Batas atas yang wajar untuk jendela catch-up, agar tidak nge-log berlebihan. */
export const CATCH_UP_MAX_LIMIT = 31;

// --- Pure date helpers (local time) ---

function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function toYMD(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pure: `ymd` digeser `delta` hari (bisa negatif), dikembalikan sebagai YYYY-MM-DD. */
export function addDaysYMD(ymd: string, delta: number): string {
  const dt = parseYMD(ymd);
  dt.setDate(dt.getDate() + delta);
  return toYMD(dt);
}

/** Pure: hari dalam minggu (0=Minggu … 6=Sabtu) untuk `ymd`. */
export function dayOfWeek(ymd: string): number {
  return parseYMD(ymd).getDay();
}

// --- Pure validation / normalisation ---

/** Pure: true iff jam valid (0.25–24, kelipatan 0.25). */
export function isValidActivityHours(h: number): boolean {
  return (
    typeof h === "number" &&
    Number.isFinite(h) &&
    h >= 0.25 &&
    h <= 24 &&
    Number.isInteger(h * 4)
  );
}

/** Pure: true iff kegiatan siap di-log (punya issueKey & jam valid). */
export function isValidActivity(a: AutoScheduleActivity): boolean {
  return (
    !!a &&
    typeof a.issueKey === "string" &&
    a.issueKey.trim().length > 0 &&
    isValidActivityHours(a.hours)
  );
}

/** Buat id lokal untuk kegiatan baru. */
export function newActivityId(): string {
  return `act-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pure: kegiatan kosong baru dengan default aman. */
export function emptyActivity(): AutoScheduleActivity {
  return {
    id: newActivityId(),
    issueKey: "",
    summary: "",
    hours: 1,
    description: "",
    startTime: "09:00",
    startDate: undefined,
    endDate: undefined,
  };
}

/**
 * Pure: true iff `ymd` berada dalam date range aktif dari activity.
 * startDate dan endDate bersifat inklusif. Jika tidak diset (undefined atau ""),
 * dianggap tanpa batas pada arah tersebut.
 */
export function isActivityInRange(activity: AutoScheduleActivity, ymd: string): boolean {
  if (activity.startDate && activity.startDate.length > 0) {
    if (ymd < activity.startDate) return false;
  }
  if (activity.endDate && activity.endDate.length > 0) {
    if (ymd > activity.endDate) return false;
  }
  return true;
}

/**
 * Pure: dari daftar activities, kembalikan hanya yang berlaku pada `ymd`
 * berdasarkan startDate/endDate masing-masing.
 */
export function filterActivitiesForDate(
  activities: AutoScheduleActivity[],
  ymd: string,
): AutoScheduleActivity[] {
  return activities.filter((a) => isActivityInRange(a, ymd));
}

// --- Slot (kegiatan × tanggal) ---

/** Satu kegiatan yang dijadwalkan pada satu tanggal tertentu. */
export interface ScheduleSlot {
  /** YYYY-MM-DD (local). */
  date: string;
  activity: AutoScheduleActivity;
}

/**
 * Pure: kunci dedup untuk satu slot. Granularitasnya (kegiatan, tanggal) —
 * bukan tanggal saja — supaya kegiatan yang ditambahkan belakangan tetap
 * bisa menghasilkan draf pada tanggal yang kegiatan lainnya sudah selesai.
 */
export function slotKey(activityId: string, ymd: string): string {
  return `${activityId}|${ymd}`;
}

/** Pure: ambil bagian tanggal dari sebuah slot key. */
export function slotKeyDate(key: string): string {
  const i = key.lastIndexOf("|");
  return i >= 0 ? key.slice(i + 1) : key;
}

/**
 * Pure: true untuk entri `processed` model lama yang menandai per-TANGGAL
 * ("YYYY-MM-DD" tanpa id kegiatan). Marker seperti ini dibuang saat load —
 * ia memblokir kegiatan baru pada tanggal tersebut, dan duplikasi tetap
 * dicegah oleh cek worklog yang sudah ada di Jira.
 */
export function isLegacyProcessedEntry(entry: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(entry);
}

/**
 * Pure: daftar slot (kegiatan × tanggal, urut naik/terlama dulu) yang
 * seharusnya diproses **sekarang**: dari hari ini mundur sampai jendela
 * catch-up, hanya tanggal yang cocok `daysOfWeek`, bukan libur (bila
 * `skipHolidays`), dan untuk tiap tanggal hanya kegiatan yang berlaku pada
 * tanggal itu serta slot-nya belum ada di `processed`.
 *
 * Mengembalikan `[]` bila fitur nonaktif atau tidak ada kegiatan.
 */
export function computeEligibleSlots(params: {
  today: string; // YYYY-MM-DD (local)
  config: AutoScheduleConfig;
  processed: Set<string> | Iterable<string>;
  isHoliday: (ymd: string) => boolean;
}): ScheduleSlot[] {
  const { today, config, isHoliday } = params;
  if (!config.enabled || config.activities.length === 0) return [];

  const processed =
    params.processed instanceof Set
      ? params.processed
      : new Set(params.processed);

  const span = config.catchUp
    ? Math.min(Math.max(1, Math.round(config.catchUpMaxDays)), CATCH_UP_MAX_LIMIT)
    : 1;

  const slots: ScheduleSlot[] = [];
  // Terlama dulu → draf tersusun kronologis.
  for (let i = span - 1; i >= 0; i--) {
    const ymd = addDaysYMD(today, -i);
    if (!config.daysOfWeek.includes(dayOfWeek(ymd))) continue;
    if (config.skipHolidays && isHoliday(ymd)) continue;
    for (const activity of filterActivitiesForDate(config.activities, ymd)) {
      if (processed.has(slotKey(activity.id, ymd))) continue;
      slots.push({ date: ymd, activity });
    }
  }
  return slots;
}

// --- Persistence ---

const SETTINGS_FILE = "settings.json";
const KEY_ENABLED = "autoScheduleEnabled";
const KEY_ACTIVITIES = "autoScheduleActivities";
const KEY_DAYS = "autoScheduleDays";
const KEY_SKIP_HOLIDAYS = "autoScheduleSkipHolidays";
const KEY_CATCHUP = "autoScheduleCatchUp";
const KEY_CATCHUP_MAX = "autoScheduleCatchUpMaxDays";
const KEY_PROCESSED = "autoScheduleProcessed";

/**
 * Muat konfigurasi auto-schedule dari `settings.json`. Mengembalikan default
 * yang aman untuk setiap key yang hilang / invalid.
 */
export async function loadAutoScheduleConfig(): Promise<AutoScheduleConfig> {
  const d = DEFAULT_AUTO_SCHEDULE_CONFIG;
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);

    const enabledRaw = await store.get<boolean>(KEY_ENABLED);
    const enabled = typeof enabledRaw === "boolean" ? enabledRaw : d.enabled;

    const activitiesRaw = await store.get<AutoScheduleActivity[]>(KEY_ACTIVITIES);
    const activities = Array.isArray(activitiesRaw)
      ? activitiesRaw
          .map((a) => ({
            id: typeof a?.id === "string" && a.id ? a.id : newActivityId(),
            issueKey: typeof a?.issueKey === "string" ? a.issueKey : "",
            summary: typeof a?.summary === "string" ? a.summary : "",
            hours: typeof a?.hours === "number" ? a.hours : 0,
            description: typeof a?.description === "string" ? a.description : "",
            startTime:
              typeof a?.startTime === "string" && /^\d{2}:\d{2}$/.test(a.startTime)
                ? a.startTime
                : "09:00",
            startDate:
              typeof a?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.startDate)
                ? a.startDate
                : undefined,
            endDate:
              typeof a?.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.endDate)
                ? a.endDate
                : undefined,
          }))
          .filter(isValidActivity)
      : [];

    const daysRaw = await store.get<number[]>(KEY_DAYS);
    const daysOfWeek =
      Array.isArray(daysRaw) && daysRaw.length > 0
        ? Array.from(
            new Set(
              daysRaw.filter(
                (n) => Number.isInteger(n) && n >= 0 && n <= 6,
              ),
            ),
          ).sort((a, b) => a - b)
        : [...d.daysOfWeek];

    const skipRaw = await store.get<boolean>(KEY_SKIP_HOLIDAYS);
    const skipHolidays = typeof skipRaw === "boolean" ? skipRaw : d.skipHolidays;

    const catchRaw = await store.get<boolean>(KEY_CATCHUP);
    const catchUp = typeof catchRaw === "boolean" ? catchRaw : d.catchUp;

    const maxRaw = await store.get<number>(KEY_CATCHUP_MAX);
    const catchUpMaxDays =
      typeof maxRaw === "number" && Number.isFinite(maxRaw)
        ? Math.min(Math.max(1, Math.round(maxRaw)), CATCH_UP_MAX_LIMIT)
        : d.catchUpMaxDays;

    return { enabled, activities, daysOfWeek, skipHolidays, catchUp, catchUpMaxDays };
  } catch {
    return { ...DEFAULT_AUTO_SCHEDULE_CONFIG };
  }
}

/** Persist konfigurasi auto-schedule ke `settings.json`. */
export async function saveAutoScheduleConfig(cfg: AutoScheduleConfig): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_ENABLED, cfg.enabled);
  await store.set(KEY_ACTIVITIES, cfg.activities.filter(isValidActivity));
  await store.set(KEY_DAYS, cfg.daysOfWeek);
  await store.set(KEY_SKIP_HOLIDAYS, cfg.skipHolidays);
  await store.set(KEY_CATCHUP, cfg.catchUp);
  await store.set(KEY_CATCHUP_MAX, cfg.catchUpMaxDays);
  await store.save();
}

/**
 * Pure: buang slot yang tanggalnya lebih tua dari `keepDays` sebelum `today`,
 * supaya file setelan tidak tumbuh tanpa batas. Pemangkasan berbasis tanggal
 * (bukan jumlah entri) karena satu tanggal kini bisa punya banyak slot —
 * memotong berdasarkan jumlah akan membuang kegiatan secara sembarangan.
 */
export function pruneProcessedSlots(
  slots: Iterable<string>,
  today: string,
  keepDays: number = 120,
): string[] {
  const cutoff = addDaysYMD(today, -Math.max(1, Math.round(keepDays)));
  return Array.from(slots)
    .filter((s) => typeof s === "string" && s.length > 0)
    .filter((s) => slotKeyDate(s) >= cutoff)
    .sort();
}

/**
 * Muat set slot (`activityId|YYYY-MM-DD`) yang sudah diproses. Entri model
 * lama yang hanya berisi tanggal dibuang — lihat `isLegacyProcessedEntry`.
 */
export async function loadProcessedSlots(): Promise<Set<string>> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    const arr = await store.get<string[]>(KEY_PROCESSED);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter((s) => typeof s === "string" && !isLegacyProcessedEntry(s)),
    );
  } catch {
    return new Set();
  }
}

/** Persist set slot yang sudah diproses, dipangkas via `pruneProcessedSlots`. */
export async function saveProcessedSlots(
  slots: Set<string> | Iterable<string>,
  keepDays: number = 120,
): Promise<void> {
  const trimmed = pruneProcessedSlots(slots, toYMD(new Date()), keepDays);
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_PROCESSED, trimmed);
  await store.save();
}
