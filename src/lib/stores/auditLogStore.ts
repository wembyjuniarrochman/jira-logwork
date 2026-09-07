/**
 * auditLogStore
 *
 * Jejak audit lokal untuk setiap aksi worklog yang dilakukan app: tambah,
 * edit (geser/resize/pindah), hapus, dan submit draf jadwal otomatis,
 * beserta error-nya. Dipakai agar user bisa melihat "app melakukan apa,
 * kapan, berhasil/gagal". Entri `source: "auto"` menandai worklog yang
 * berasal dari draf penjadwalan otomatis (disubmit user via staging bar).
 *
 * Persistensi: file `audit-log.json` (Tauri store), dibatasi `MAX_ENTRIES`
 * entri terbaru agar tidak membengkak.
 */

// --- Types ---

/** Operasi terhadap worklog. */
export type AuditAction = "add" | "edit" | "delete";

/** Hasil aksi. */
export type AuditStatus = "success" | "failed" | "queued";

/** Asal aksi: dilakukan user (`manual`) atau penjadwalan (`auto`). */
export type AuditSource = "manual" | "auto";

export interface AuditEntry {
  id: string;
  /** ISO 8601 timestamp saat aksi dicatat. */
  timestamp: string;
  action: AuditAction;
  source: AuditSource;
  status: AuditStatus;
  issueKey?: string;
  /** Tanggal worklog (YYYY-MM-DD) yang terpengaruh. */
  date?: string;
  hours?: number;
  /** Detail tambahan / pesan error. */
  message?: string;
}

// --- Constants ---

export const MAX_ENTRIES = 1000;
const STORE_FILE = "audit-log.json";
const KEY_ENTRIES = "entries";

// --- Id ---

export function newAuditId(): string {
  return `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lengkapi sebuah entry parsial dengan id + timestamp bila belum ada.
 * `timestamp` dibuat di sini (waktu pencatatan) kecuali pemanggil sudah
 * menyediakannya.
 */
export function makeAuditEntry(
  partial: Omit<AuditEntry, "id" | "timestamp"> & Partial<Pick<AuditEntry, "id" | "timestamp">>,
): AuditEntry {
  return {
    id: partial.id ?? newAuditId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    action: partial.action,
    source: partial.source,
    status: partial.status,
    issueKey: partial.issueKey,
    date: partial.date,
    hours: partial.hours,
    message: partial.message,
  };
}

// --- Pure helpers ---

/** Pure: gabungkan entri baru (terbaru dulu) di depan, lalu potong ke `max`. */
export function prependCapped(
  existing: AuditEntry[],
  additions: AuditEntry[],
  max: number = MAX_ENTRIES,
): AuditEntry[] {
  // Additions diberikan urutan kronologis; tampilkan terbaru dulu.
  const merged = [...[...additions].reverse(), ...existing];
  return merged.slice(0, max);
}

function csvCell(value: string | number | undefined): string {
  const s = value === undefined || value === null ? "" : String(value);
  // Escape untuk CSV (quote bila mengandung koma/kutip/baris baru).
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Pure: render daftar entry sebagai teks CSV (dengan header). */
export function toCsv(entries: AuditEntry[]): string {
  const header = [
    "timestamp",
    "action",
    "source",
    "status",
    "issueKey",
    "date",
    "hours",
    "message",
  ];
  const rows = entries.map((e) =>
    [
      e.timestamp,
      e.action,
      e.source,
      e.status,
      e.issueKey,
      e.date,
      e.hours,
      e.message,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// --- Persistence ---

/** Muat seluruh entri audit (terbaru dulu, sesuai urutan tersimpan). */
export async function loadAuditLog(): Promise<AuditEntry[]> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE);
    const arr = await store.get<AuditEntry[]>(KEY_ENTRIES);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Persist seluruh daftar entri (dipanggil setelah append/clear). */
export async function saveAuditLog(entries: AuditEntry[]): Promise<void> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE);
    await store.set(KEY_ENTRIES, entries.slice(0, MAX_ENTRIES));
    await store.save();
  } catch {
    /* best-effort — jangan blokir alur utama karena gagal mencatat */
  }
}

/** Kosongkan seluruh log audit. */
export async function clearAuditLog(): Promise<void> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE);
    await store.set(KEY_ENTRIES, []);
    await store.save();
  } catch {
    /* best-effort */
  }
}
