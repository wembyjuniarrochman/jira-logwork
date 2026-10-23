/**
 * animationStore
 *
 * Preferensi "kurangi animasi". Saat aktif, latar dekoratif yang beranimasi
 * (AnimatedBackground di workspace, BackgroundPaths di login) berhenti
 * berdenyut sepenuhnya.
 *
 * Latar belakang: beberapa user Windows melaporkan aplikasi membuat mesin
 * terasa lambat. Penyebab utamanya adalah animasi CSS tak terbatas pada latar
 * dekoratif — orb ber-`blur` besar dan puluhan garis SVG — yang di WebView2
 * memaksa compositor melukis ulang terus-menerus. Gating per-visibilitas
 * (lihat `main.ts`) sudah menjeda animasi saat jendela tersembunyi; toggle ini
 * memberi user mesin low-end jalan keluar manual untuk mematikannya sama
 * sekali, bahkan saat jendela aktif.
 *
 * Diterapkan sebagai atribut `data-reduce-animations` pada `<html>`, sama
 * seperti `themeStore` menulis `data-theme`. CSS yang membaca atribut ini
 * mematikan animasi; tidak ada komponen yang perlu tahu soal preferensi ini.
 */

const SETTINGS_FILE = "settings.json";
const KEY_REDUCE_ANIMATIONS = "reduceAnimations";

// Default: animasi tetap menyala untuk instalasi baru, menjaga tampilan
// seperti sebelumnya. User yang terganggu performa bisa mematikannya.
export const DEFAULT_REDUCE_ANIMATIONS = false;

/** Pure: true iff `value` adalah boolean yang sah untuk preferensi ini. */
export function isReduceAnimations(value: unknown): value is boolean {
  return typeof value === "boolean";
}

// --- State ---

let reduceAnimations = $state<boolean>(DEFAULT_REDUCE_ANIMATIONS);

/** Preferensi yang dipilih user. */
export function reduceAnimationsEnabled(): boolean {
  return reduceAnimations;
}

// --- Efek ke DOM ---

/**
 * Tulis preferensi ke `<html data-reduce-animations>`. Aman dipanggil sebelum
 * DOM siap (mis. saat tes) — cukup tidak melakukan apa-apa. Atribut hanya
 * dipasang saat aktif, selaras dengan pola `data-doc-hidden`.
 */
function applyToDocument(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (reduceAnimations) root.setAttribute("data-reduce-animations", "");
  else root.removeAttribute("data-reduce-animations");
}

/** Ganti preferensi, terapkan seketika, lalu persist. */
export function setReduceAnimations(next: boolean): void {
  reduceAnimations = next;
  applyToDocument();
  void saveReduceAnimations(next);
}

// --- Persistensi ---

/** Muat preferensi dari `settings.json`; default `false` untuk instalasi baru. */
export async function loadReduceAnimations(): Promise<boolean> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    const raw = await store.get<boolean>(KEY_REDUCE_ANIMATIONS);
    return isReduceAnimations(raw) ? raw : DEFAULT_REDUCE_ANIMATIONS;
  } catch {
    return DEFAULT_REDUCE_ANIMATIONS;
  }
}

/** Persist preferensi. Best-effort — kegagalan tidak boleh memblokir UI. */
export async function saveReduceAnimations(value: boolean): Promise<void> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    await store.set(KEY_REDUCE_ANIMATIONS, value);
    await store.save();
  } catch {
    /* best-effort */
  }
}

/**
 * Muat preferensi tersimpan lalu terapkan. Dipanggil sekali saat aplikasi
 * dimulai.
 */
export async function hydrateReduceAnimations(): Promise<void> {
  reduceAnimations = await loadReduceAnimations();
  applyToDocument();
}
