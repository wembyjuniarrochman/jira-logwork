# JIRA Logwork — Context Ringkas

Dokumen ini adalah konteks minimum yang perlu dibaca pada awal session baru.
Baca dokumen lain hanya bila tugas membutuhkannya.

## Identitas proyek

- Nama: JIRA Logwork
- Versi saat ini: `1.0.7` — ubah `package.json` sebagai sumber utama.
- Stack: Tauri 2, Rust, Svelte 5, TypeScript, Vite.
- Entry frontend: `src/main.ts` → `src/App.svelte`.
- Backend/native commands: `src-tauri/src/lib.rs`; integrasi Jira ada di
  `src-tauri/src/jira.rs`.

## Area produk

- Login dan koneksi Jira Cloud melalui URL, email, dan API token.
- Workspace kalender untuk worklog milik user; create, edit/move, delete, dan
  sync ke Jira.
- Draft jadwal otomatis yang harus direview sebelum dikirim.
- Quick Log dari system tray dan autostart.
- Cache worklog/offline state, audit log, weekly summary, serta kalender hari
  libur Indonesia.
- Bantuan AI opsional untuk memperbaiki deskripsi; provider: OpenAI, Gemini,
  atau Claude.
- Auto-update Tauri dari GitHub Releases memakai signature minisign.

## Persistence dan keamanan

- Preference dan kredensial Jira memakai Tauri Store `settings.json`.
- API key AI memakai OS keychain melalui Rust `keyring`; renderer tidak
  menerima nilai key secara langsung.
- Private updater key berada di `~/.tauri/jira-logwork.key` dan di-ignore oleh
  Git. Jangan tampilkan nilainya dalam output, diff, atau prompt.
- Endpoint updater aktif di `src-tauri/tauri.conf.json` dan mengarah ke GitHub
  Releases repository proyek.

## File yang paling sering disentuh

| Area | File |
| --- | --- |
| Shell aplikasi / routing | `src/App.svelte`, `src/lib/pages/` |
| State | `src/lib/stores/` |
| UI | `src/lib/components/`, `src/app.css` |
| Jira API dan Tauri commands | `src-tauri/src/jira.rs`, `src-tauri/src/lib.rs` |
| Konfigurasi | `package.json`, `src-tauri/tauri.conf.json` |
| Test | file `*.test.ts` di bawah `src/` |

## Validasi standar

```bash
npm test
npm run build
```

Untuk rilis atau cross-compile, baca [OPERATIONS.md](OPERATIONS.md). Untuk
prioritas fitur, baca [../ROADMAP.md](../ROADMAP.md).

## Kontrak kerja session baru

1. Pahami `docs/CONTEXT.md` sebelum menjelajah file lain.
2. Baca hanya file yang relevan dengan tugas.
3. Jangan mengubah API, persistence, atau perilaku keamanan tanpa menyebutkan
   dampaknya.
4. Setelah perubahan, jalankan validasi yang relevan dan sebutkan hasilnya.
