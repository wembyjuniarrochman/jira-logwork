/**
 * themeStore
 *
 * Pilihan tema aplikasi: `auto` (ikut sistem operasi), `light`, atau `dark`.
 *
 * Tema diterapkan sebagai atribut `data-theme` pada elemen `<html>`, dan
 * seluruh warna di CSS diturunkan dari token yang di-override oleh atribut
 * itu. Konsekuensinya pergantian tema tidak perlu menyentuh komponen sama
 * sekali — cukup satu atribut berubah.
 *
 * Mode `auto` memantau `prefers-color-scheme` secara langsung, jadi kalau
 * user mengubah tema OS saat aplikasi terbuka, tampilannya ikut berpindah
 * tanpa perlu restart.
 */

const SETTINGS_FILE = "settings.json";
const KEY_THEME = "themePreference";

/** Yang dipilih user. */
export type ThemePreference = "auto" | "light" | "dark";

/** Yang benar-benar dirender, setelah `auto` diselesaikan. */
export type ResolvedTheme = "light" | "dark";

// Instalasi baru dimulai dengan tema gelap. Preferensi yang sudah pernah
// dipilih user tetap dimuat dari settings.json dan tidak ditimpa.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

/** Pure: true iff `value` adalah preferensi tema yang sah. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

/**
 * Pure: terjemahkan preferensi + kondisi OS menjadi tema yang dipakai.
 * Dipisah dari efek samping agar bisa diuji tanpa DOM.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "auto") return systemPrefersDark ? "dark" : "light";
  return preference;
}

// --- State ---

let preference = $state<ThemePreference>(DEFAULT_THEME_PREFERENCE);
let systemPrefersDark = $state<boolean>(true);

/** Preferensi yang dipilih user (auto / light / dark). */
export function themePreference(): ThemePreference {
  return preference;
}

/** Tema yang benar-benar aktif setelah `auto` diselesaikan. */
export function resolvedTheme(): ResolvedTheme {
  return resolveTheme(preference, systemPrefersDark);
}

// --- Efek ke DOM ---

/**
 * Tulis tema aktif ke `<html data-theme="...">`. Aman dipanggil sebelum
 * DOM siap (mis. saat SSR/tes) — cukup tidak melakukan apa-apa.
 */
function applyToDocument(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolvedTheme());
}

/**
 * Pasang pemantauan `prefers-color-scheme` dan terapkan tema pertama kali.
 * Mengembalikan fungsi pembersih.
 */
export function initTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    applyToDocument();
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  systemPrefersDark = mq.matches;
  applyToDocument();

  const onChange = (e: MediaQueryListEvent) => {
    systemPrefersDark = e.matches;
    applyToDocument();
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Ganti preferensi tema, terapkan seketika, lalu persist. */
export function setThemePreference(next: ThemePreference): void {
  preference = next;
  applyToDocument();
  void saveThemePreference(next);
}

// --- Persistensi ---

/** Muat preferensi tema dari `settings.json`; default `dark` untuk instalasi baru. */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    const raw = await store.get<string>(KEY_THEME);
    return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persist preferensi tema. Best-effort — kegagalan tidak boleh memblokir UI. */
export async function saveThemePreference(value: ThemePreference): Promise<void> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    await store.set(KEY_THEME, value);
    await store.save();
  } catch {
    /* best-effort */
  }
}

/**
 * Muat preferensi tersimpan lalu terapkan. Dipanggil sekali saat aplikasi
 * dimulai, setelah `initTheme()` memasang pemantau OS.
 */
export async function hydrateTheme(): Promise<void> {
  preference = await loadThemePreference();
  applyToDocument();
}
