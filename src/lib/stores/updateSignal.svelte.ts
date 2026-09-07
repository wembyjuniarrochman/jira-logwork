/**
 * updateSignal
 *
 * Jembatan satu arah antara tombol "Cek pembaruan" di panel Tentang
 * (SettingsDrawer) dan `UpdateBanner`, yang memiliki seluruh alur unduh +
 * pasang.
 *
 * Tanpa ini, pengecekan manual harus menduplikasi UI progres dan penanganan
 * error milik banner. Dengan sebuah counter yang dinaikkan, banner cukup
 * memantaunya lewat `$effect` dan menjalankan ulang pengecekan — satu
 * implementasi alur update, dua pemicu.
 */

let counter = $state(0);

/** Dibaca `UpdateBanner`; berubah nilainya = permintaan cek ulang. */
export function updateCheckRequest(): number {
  return counter;
}

/** Minta `UpdateBanner` mengecek pembaruan sekarang. */
export function requestUpdateCheck(): void {
  counter += 1;
}
