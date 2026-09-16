# Operasional: Build dan Rilis

Dokumen ini menggabungkan panduan build, rilis, auto-update, dan troubleshooting.
Untuk konteks singkat saja, gunakan [CONTEXT.md](CONTEXT.md).

## Perintah utama

| Tujuan | Perintah |
| --- | --- |
| Development | `npm run dev` |
| Test | `npm test` |
| Build frontend | `npm run build` |
| Build macOS host | `npm run tauri build` |
| Build Windows dari macOS | `npm run release:win` |
| Build macOS universal | `npm run release:mac` |
| Generate feed updater | `npm run release:feed -- --notes "..."` |

## Build Windows dari macOS

Prasyarat sekali saja:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
brew install makensis llvm
```

`llvm-rc` harus ada di PATH:

```bash
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
npm run release:win
```

Installer berada di:
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

## Build langsung Windows

Install Node.js LTS, Rust melalui `rustup`, dan Visual Studio Build Tools dengan
workload **Desktop development with C++**, lalu jalankan:

```powershell
npm install
npm run tauri build
```

Installer berada di `src-tauri\target\release\bundle\nsis\`.

## Rilis dan auto-update

1. Naikkan versi di `package.json`; sinkronkan `src-tauri/Cargo.toml`.
2. Pastikan `TAURI_SIGNING_PRIVATE_KEY` menunjuk ke private key updater.
3. Build Windows dan macOS.
4. Generate `latest.json`.
5. Upload `latest.json` dan artefak updater ke GitHub Release dengan tag
   `v<versi>`.

Contoh:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/jira-logwork.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run release:win
npm run release:mac
npm run release:feed -- --notes "Ringkasan perubahan"
gh release create v1.0.8 latest.json <artefak-release> \
  --title "v1.0.8" --notes "Ringkasan perubahan"
```

`release:mac` harus membangun `app,dmg` agar artefak updater `.app.tar.gz`
tersedia. Feed updater memakai endpoint yang sudah dikonfigurasi di
`src-tauri/tauri.conf.json`.

## Catatan distribusi

Build tanpa code-signing OS dapat memicu SmartScreen di Windows dan Gatekeeper
di macOS. Untuk macOS, penerima dapat membuka aplikasi dengan klik kanan →
**Open**, atau setelah menyalin ke Applications menjalankan:

```bash
xattr -cr "/Applications/JIRA Logwork.app"
```

## Troubleshooting cepat

| Gejala | Periksa |
| --- | --- |
| `npm`/`rustc` tidak ditemukan | Instal toolchain dan restart terminal |
| `link.exe not found` | Visual Studio Build Tools + workload C++ |
| `llvm-rc` gagal | Tambahkan LLVM Homebrew ke PATH |
| Auto-update tidak muncul | `latest.json` publik, versi lebih tinggi, platform key cocok |
| Signature gagal | Private key benar dan artefak `.sig` dibuat saat build |
