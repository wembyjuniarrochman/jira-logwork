/**
 * autostartStore
 *
 * Pembungkus tipis di atas `@tauri-apps/plugin-autostart` untuk fitur
 * "jalankan saat login" (Level 2 penjadwalan otomatis). Semua panggilan
 * dibungkus try/catch supaya aman di lingkungan non-Tauri (mis. test / web
 * preview) — di sana fungsinya jadi no-op.
 */

/** True iff app terdaftar untuk jalan otomatis saat login. */
export async function isAutostartEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch {
    return false;
  }
}

/**
 * Aktif/nonaktifkan autostart. Idempotent: mengecek state saat ini dulu agar
 * tidak mendaftar/menghapus ganda. Melempar bila plugin gagal (dibiarkan
 * ke pemanggil untuk ditampilkan), tapi absennya plugin diperlakukan no-op.
 */
export async function setAutostart(on: boolean): Promise<void> {
  let mod: typeof import("@tauri-apps/plugin-autostart");
  try {
    mod = await import("@tauri-apps/plugin-autostart");
  } catch {
    // Plugin tidak tersedia (lingkungan non-Tauri) — no-op.
    return;
  }
  const current = await mod.isEnabled();
  if (on && !current) {
    await mod.enable();
  } else if (!on && current) {
    await mod.disable();
  }
}
