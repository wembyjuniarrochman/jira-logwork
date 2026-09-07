// src/lib/stores/quickLogReducer.ts
//
// Pure (no Tauri, no Svelte, no side effects) helpers powering QuickLogCard.
//
// Mirrors the design's Property 14 (canSubmit), Property 15 (chip group radio
// invariants), Property 16 (custom hours / description validators), Property 17
// (avatar initial derivation), and Property 20 (credentials banner visibility).

import { isCredentialComplete, type Credentials } from "./authStore";

// --- Types ---

export type SubmitState = "idle" | "submitting" | "success" | "error" | "queued";

/**
 * Nilai chip, dalam jam.
 *
 * Sengaja `number`, bukan union literal: 5 menit adalah 1/12 jam yang tidak
 * punya representasi desimal terbatas, sehingga literal seperti
 * `0.0833333333333333` tidak akan pernah cocok persis dengan `5 / 60`.
 * Daftar preset yang sahih ada di `PRESET_MINUTES`.
 */
export type ChipValue = number;

/**
 * Preset durasi dalam **menit** — sumber tunggal untuk chip maupun
 * pencocokan. Disimpan sebagai bilangan bulat menit supaya perbandingan
 * tidak pernah bergantung pada kesetaraan float.
 */
export const PRESET_MINUTES: readonly number[] = [5, 15, 30, 60, 120, 240, 480];

/** Pure: jam → menit bulat. Titik konversi tunggal antara dua satuan. */
export function minutesOf(hours: number): number {
  return Math.round(hours * 60);
}

/** Pure: label ringkas — "5m", "30m", "1h", "2h". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * Panjang satu hari kerja, dalam jam.
 *
 * Mengikuti konvensi Jira (`1d = 8h`), bukan 24 jam — di konteks pencatatan
 * kerja, "1 hari" berarti satu hari kerja. Nilainya tetap agar konversi
 * selalu bisa ditebak; hint di UI menyebutkannya secara eksplisit supaya
 * tidak ada yang menerka-nerka.
 */
export const HOURS_PER_DAY = 8;

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/**
 * Pure: pecah jam desimal menjadi hari/jam/menit. Bekerja lewat menit bulat
 * supaya 1/12 jam (5 menit) tidak hanyut oleh pembulatan float.
 */
export function splitDuration(hours: number): DurationParts {
  if (!Number.isFinite(hours) || hours <= 0) {
    return { days: 0, hours: 0, minutes: 0 };
  }
  const total = Math.round(hours * 60);
  const dayMinutes = HOURS_PER_DAY * 60;
  const days = Math.floor(total / dayMinutes);
  const rest = total - days * dayMinutes;
  return { days, hours: Math.floor(rest / 60), minutes: rest % 60 };
}

/** Batas atas satu worklog, dalam menit. */
export const MAX_MINUTES = 24 * 60;

/**
 * Pure: bulatkan ke kelipatan 5 menit lalu jepit ke [5, 24 jam].
 *
 * Dipakai saat menormalkan tiga kolom durasi, sehingga nilai yang terlihat
 * selalu sama dengan nilai yang akan dikirim — mengetik 39 menit tidak lagi
 * menghasilkan field terisi tetapi tak pernah ter-commit karena gagal
 * validasi kelipatan 5.
 */
export function normalizeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const snapped = Math.round(minutes / MIN_STEP_MINUTES) * MIN_STEP_MINUTES;
  return Math.min(Math.max(snapped, MIN_STEP_MINUTES), MAX_MINUTES);
}

/** Label satuan untuk `formatDurationLong`, disuplai pemanggil. */
export interface DurationUnits {
  day: string;
  hour: string;
  minute: string;
}

/**
 * Pure: durasi dalam kata, mis. "1 day 2 hours", "30 minutes". Bagian yang
 * bernilai nol dilewati, dan nol total menghasilkan string kosong.
 *
 * Label satuannya diterima sebagai argumen, bukan ditulis di sini: fungsi
 * ini dipakai di dalam kalimat yang diterjemahkan, dan satuan berbahasa
 * Indonesia yang tertanam akan bocor ke tampilan bahasa Inggris.
 */
export function formatDurationLong(
  minutes: number,
  units: DurationUnits = { day: "hari", hour: "jam", minute: "menit" },
): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const p = splitDuration(minutes / 60);
  const parts: string[] = [];
  if (p.days) parts.push(`${p.days} ${units.day}`);
  if (p.hours) parts.push(`${p.hours} ${units.hour}`);
  if (p.minutes) parts.push(`${p.minutes} ${units.minute}`);
  return parts.join(" ");
}

/**
 * Pure: jam desimal yang ringkas — "0.25h", "1.5h", "8h".
 *
 * Bentuk inilah yang dipakai Jira dan kebanyakan timesheet, sementara tiga
 * kolom Hari/Jam/Menit bersifat saling melengkapi. Menampilkan keduanya
 * berdampingan menjawab "berapa desimalnya" tanpa membuat kolom Jam
 * menyalin nilai kolom Menit — yang justru akan terbaca dobel.
 */
export function formatDecimalHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = minutes / 60;
  // Buang nol di belakang: 8.00 -> 8, 1.50 -> 1.5, 0.25 tetap 0.25.
  return `${Number(hours.toFixed(2))}h`;
}

/** Pure: gabungkan hari/jam/menit menjadi jam desimal. */
export function joinDuration(days: number, hours: number, minutes: number): number {
  const d = Number.isFinite(days) ? days : 0;
  const h = Number.isFinite(hours) ? hours : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return (d * HOURS_PER_DAY * 60 + h * 60 + m) / 60;
}

export interface SelectedIssue {
  key: string;
  summary: string;
  /** Nama issue type dari Jira, diteruskan ke cache recent untuk ikonnya. */
  issueType?: string;
}

export interface CanSubmitArgs {
  recentIssuesReady: boolean;
  selectedIssue: SelectedIssue | null;
  effectiveHours: number;
  submitState: SubmitState;
}

export interface ChipState {
  chipHours: ChipValue | null;
  customHours: number | null;
}

export type ChipAction =
  | { type: "chipClick"; value: ChipValue }
  | { type: "customHours"; value: number | null };

// --- canSubmit (Property 14) ---

/**
 * Pure: Submit is allowed iff recent-issues cache is ready, an issue is
 * selected, hours > 0, and we are not already submitting.
 */
export function canSubmit({
  recentIssuesReady,
  selectedIssue,
  effectiveHours,
  submitState,
}: CanSubmitArgs): boolean {
  return (
    recentIssuesReady === true &&
    selectedIssue !== null &&
    effectiveHours > 0 &&
    submitState !== "submitting"
  );
}

// --- chipReducer (Property 15) ---

/**
 * Pure: maintains the single-selection radio invariant for the time-preset
 * chip group plus the mutually-exclusive custom-hours input.
 *
 * - `chipClick(value)`: selects the chip and clears any custom-hours value.
 * - `customHours(value)`:
 *   - `null`        → clears the custom value, leaves chip selection intact.
 *   - valid number  → sets the custom value and clears any chip selection.
 *   - invalid value → returns state unchanged (so partial typing does not
 *     accidentally deselect a chip).
 */
export function chipReducer(state: ChipState, action: ChipAction): ChipState {
  switch (action.type) {
    case "chipClick":
      return { chipHours: action.value, customHours: null };
    case "customHours": {
      if (action.value === null) {
        return { chipHours: state.chipHours, customHours: null };
      }
      if (isValidCustomHours(action.value)) {
        return { chipHours: null, customHours: action.value };
      }
      return state;
    }
  }
}

// --- Validators (Property 16) ---

/** Satuan terkecil yang bisa dicatat, dalam menit. */
export const MIN_STEP_MINUTES = 5;

/**
 * Pure: durasi yang sah adalah kelipatan 5 menit, dari 5 menit sampai 24 jam.
 *
 * Sebelumnya batasnya kelipatan 0.25 jam (15 menit), sehingga tugas pendek
 * seperti stand-up 5 menit tidak bisa dicatat sama sekali. Batas itu buatan
 * aplikasi ini, bukan Jira — Jira menyimpan `timeSpentSeconds`, jadi 300
 * detik sepenuhnya sah.
 *
 * Validasi dilakukan dalam menit, bukan jam: 5 menit adalah 1/12 jam yang
 * tidak pernah bulat di floating point, sehingga pengecekan gaya
 * `Number.isInteger(h * 12)` akan menolak nilainya sendiri.
 */
export function isValidCustomHours(h: number): boolean {
  if (typeof h !== "number" || !Number.isFinite(h)) {
    return false;
  }
  const minutes = h * 60;
  const rounded = Math.round(minutes);
  // Tolak nilai yang bukan menit bulat (mis. 0.001 jam).
  if (Math.abs(minutes - rounded) > 1e-6) {
    return false;
  }
  return (
    rounded >= MIN_STEP_MINUTES &&
    rounded <= 24 * 60 &&
    rounded % MIN_STEP_MINUTES === 0
  );
}

/**
 * Pure: description is valid when it does not exceed 500 characters.
 */
export function isValidDescription(s: string): boolean {
  return typeof s === "string" && s.length <= 500;
}

// --- initialFor (Property 17) ---

/**
 * Pure: returns the avatar initial.
 *
 * - First non-whitespace character of `displayName`, upper-cased, when the
 *   display name has any non-whitespace content.
 * - Otherwise the first non-whitespace character of `email`, upper-cased.
 * - Otherwise `'?'`.
 */
export function initialFor(displayName: string, email: string): string {
  const fromName = firstNonWhitespaceChar(displayName);
  if (fromName !== null) {
    return fromName.toUpperCase();
  }
  const fromEmail = firstNonWhitespaceChar(email);
  if (fromEmail !== null) {
    return fromEmail.toUpperCase();
  }
  return "?";
}

function firstNonWhitespaceChar(s: string): string | null {
  if (typeof s !== "string") {
    return null;
  }
  for (const ch of s) {
    if (!/\s/.test(ch)) {
      return ch;
    }
  }
  return null;
}

// --- shouldShowCredentialsBanner (Property 20) ---

/**
 * Pure: the credentials banner is shown iff credentials are incomplete. Reuses
 * the existing `isCredentialComplete` predicate from `authStore` so the banner
 * tracks the same definition as authentication.
 */
export function shouldShowCredentialsBanner(creds: Credentials): boolean {
  return !isCredentialComplete(creds);
}
