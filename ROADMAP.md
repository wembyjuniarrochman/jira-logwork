# Roadmap JIRA Logwork

Fitur sinkronisasi yang andal sudah menjadi fokus pengembangan saat ini. Ide pengembangan berikut disimpan untuk tahap selanjutnya.

## Deteksi bentrok waktu

- Peringatan ketika dua worklog memiliki rentang waktu yang bertumpuk.
- Deteksi worklog yang melewati jam istirahat.
- Penanda celah waktu yang belum terisi terhadap target harian.

## Peningkatan Daily Activity

- Preview draf sebelum dibuat.
- Template aktivitas berbeda berdasarkan hari.
- Opsi melewati hari libur dan cuti.
- Status yang jelas: Draf, Mengirim, Terkirim, atau Gagal.

## Penyimpanan token Jira yang lebih aman

- [ ] Simpan API token Jira melalui Keychain macOS dan Credential Manager Windows.
- [ ] Migrasikan token Jira yang masih tersimpan di file pengaturan biasa.

Catatan: API key AI sudah disimpan melalui OS keychain. Item roadmap ini hanya
menyangkut API token Jira.

## Riwayat dan pemulihan perubahan

- Undo setelah menghapus atau memindahkan worklog.
- Filter audit log berdasarkan tanggal, issue, dan status.
- Retry langsung untuk operasi yang gagal.

## Laporan

- Ringkasan mingguan dan bulanan berdasarkan project atau issue.
- Perbandingan target dengan realisasi.
- Export ke CSV, Excel, atau gambar.
- Penanda hari dengan kekurangan atau kelebihan jam.

## Peningkatan kalender

- Pencarian worklog.
- Filter berdasarkan project atau issue.
- Indikator hari libur yang konsisten di semua mode.
- Pilihan awal minggu: Minggu atau Senin.

## Selesai: update aplikasi yang lebih aman

- [x] Tampilkan versi lama dan versi baru.
- [x] Release notes sebelum instalasi.
- [x] Verifikasi versi baru setelah restart.
- [x] Retry jika instalasi atau restart gagal.

## Selesai: onboarding pengguna baru

- [x] Panduan mendapatkan Jira API Token.
- [x] Tes koneksi sebelum login.
- [x] Pengaturan awal target jam, jam kerja, dan jam istirahat.
