/**
 * updaterStore
 *
 * Pembungkus tipis di atas `@tauri-apps/plugin-updater`.
 *
 * Alurnya: aplikasi menanyakan endpoint update saat dibuka → kalau ada versi
 * lebih baru, UI menawarkan pemasangan → paket diunduh, diverifikasi
 * tanda tangannya oleh plugin, dipasang, lalu aplikasi di-restart.
 *
 * Semua fungsi di sini aman dipanggil di luar Tauri (mis. saat `vite dev` di
 * browser): impor plugin dilakukan dinamis dan kegagalannya diperlakukan
 * sebagai "tidak ada update", karena pengecekan update tidak boleh sampai
 * menghalangi pemakaian aplikasi.
 */

/** Progres unduhan; `total` bisa null kalau server tidak mengirim ukuran. */
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export interface AvailableUpdate {
  version: string;
  /** Catatan rilis dari `latest.json`, kalau diisi saat rilis. */
  notes?: string;
  /** Tanggal rilis mentah dari feed. */
  date?: string;
  /** Handle plugin — disimpan agar `downloadAndInstall` memakai objek yang sama. */
  raw: unknown;
}

/**
 * Pure: format byte jadi teks ringkas ("4.2 MB"). Dipakai indikator progres.
 * Dipisah agar bisa diuji tanpa menyentuh Tauri.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Pure: persentase unduhan 0–100, atau null kalau ukuran total tidak
 * diketahui (progress bar jatuh ke mode indeterminate).
 */
export function downloadPercent(p: DownloadProgress): number | null {
  if (!p.total || p.total <= 0) return null;
  return Math.min(100, Math.round((p.downloaded / p.total) * 100));
}

/**
 * Cek apakah ada versi lebih baru. Mengembalikan `null` bila sudah terbaru,
 * endpoint tidak terjangkau, atau kita tidak berjalan di dalam Tauri.
 *
 * Sengaja tidak melempar: gagal menghubungi server update bukan kondisi
 * error yang perlu ditampilkan ke user setiap kali aplikasi dibuka.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
      raw: update,
    };
  } catch {
    return null;
  }
}

/**
 * Unduh + pasang update, lalu restart aplikasi. `onProgress` dipanggil
 * selama pengunduhan sehingga UI bisa menampilkan kemajuannya.
 *
 * Melempar bila gagal — di sini error memang perlu dilihat user, karena ia
 * baru saja menekan tombol pasang.
 */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const handle = update.raw as {
    download: (cb: (e: DownloadEvent) => void) => Promise<void>;
    install: (options: { restartAfterInstall: boolean }) => Promise<void>;
  };

  let downloaded = 0;
  let total: number | null = null;

  await handle.download((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      downloaded = 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }
    onProgress?.({ downloaded, total });
  });

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prepare_update_restart", { version: update.version });
  // Windows exits here and the installer launches the new application.
  await handle.install({ restartAfterInstall: true });
  // macOS/Linux return after installation and require an explicit restart.
  try {
    await restartAfterUpdate();
  } catch (error) {
    throw new UpdateRestartError(error);
  }
}

export class UpdateRestartError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "UpdateRestartError";
  }
}

export async function restartAfterUpdate(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Bentuk event progres dari plugin updater. */
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** Versi aplikasi yang sedang berjalan, untuk ditampilkan di UI. */
export async function currentVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "";
  }
}

/**
 * Ambil bukti satu-kali bahwa proses restart benar-benar menjalankan versi
 * yang diminta updater. Marker dibuat oleh Rust setelah versi binary cocok.
 */
export async function takeInstalledUpdate(): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("take_update_success");
  } catch {
    return null;
  }
}
