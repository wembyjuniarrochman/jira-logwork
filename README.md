# JIRA Logwork

Aplikasi desktop Tauri + Svelte untuk mencatat, melihat, memindahkan, dan
menjadwalkan worklog Jira. Aplikasi juga menyediakan Quick Log dari system
tray, cache offline, audit log, kalender, serta bantuan AI opsional untuk
merapikan deskripsi worklog.

## Status singkat

- Versi aplikasi: `1.0.7` (sumber versi: `package.json`)
- Platform: macOS dan Windows x64
- Backend native: Rust/Tauri 2
- Frontend: Svelte 5 + TypeScript + Vite
- Pengujian: Vitest
- Repository: `wembyjuniarrochman/jira-logwork`

## Mulai cepat

```bash
npm install
npm run tauri dev
npm test
npm run build
```

Perintah rilis dan detail operasional ada di [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Peta dokumentasi

| Kebutuhan | Dokumen |
| --- | --- |
| Konteks singkat untuk session AI baru | [docs/CONTEXT.md](docs/CONTEXT.md) |
| Build, release, auto-update, troubleshooting | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Fitur yang sudah ada dan ide berikutnya | [ROADMAP.md](ROADMAP.md) |

`BUILD-WINDOWS.md` dan `RELEASING.md` dipertahankan sebagai tautan kompatibilitas
untuk referensi lama. Isi operasional kanonis sekarang berada di
`docs/OPERATIONS.md`.

## Keamanan kredensial

- Kredensial Jira disimpan oleh Tauri Store di `settings.json`. Token hanya
  dihapus saat logout jika opsi “remember token” tidak aktif.
- API key AI tidak disimpan di `settings.json`; key disimpan di OS keychain
  melalui crate Rust `keyring`.
- Jangan menaruh token, API key, private signing key, atau isi `.env` di
  repository, issue, log, atau prompt.
- Private signing key update bersifat setara akses rilis aplikasi. Simpan
  backup-nya di password manager dan jangan pernah commit.

## Pola prompting hemat token

Pada session baru, kirim konteks minimum berikut dan minta agent membaca file
yang relevan saja:

```text
Repo: jira-logwork. Baca docs/CONTEXT.md terlebih dahulu.
Tugas: <jelaskan perubahan yang diinginkan>.
Batasan: ubah hanya area yang relevan; jangan membaca seluruh repo.
Validasi: jalankan test/build yang relevan dan laporkan file yang berubah.
Jika menyentuh build atau rilis, baca docs/OPERATIONS.md juga.
```

Untuk perubahan UI, arahkan agent ke file komponen/halaman terkait. Untuk
perubahan Jira atau persistence, arahkan ke `src-tauri/src/` dan store terkait;
hindari meminta ringkasan seluruh codebase.

## Aturan dokumentasi

Dokumentasi kanonis disimpan sebagai Markdown di root atau `docs/`. Saat
perilaku aplikasi berubah, perbarui `docs/CONTEXT.md` hanya jika ringkasan
arsitektur atau keamanan ikut berubah; detail prosedur tetap di
`docs/OPERATIONS.md`. Gunakan contoh placeholder untuk semua credential.
