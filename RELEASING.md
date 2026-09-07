# Rilis & Auto-Update

Aplikasi mengecek versi baru setiap kali dibuka. Kalau ada, banner muncul di
kanan bawah; user menekan **Update**, paket diunduh + diverifikasi tanda
tangannya, dipasang, lalu aplikasi dimuat ulang.

Feed update dihosting di **GitHub Releases** pada repo publik.

---

## 1. Yang harus disiapkan sekali (BELUM selesai)

### a. Ganti placeholder endpoint

`src-tauri/tauri.conf.json` masih berisi:

```
https://github.com/GANTI-USERNAME-GITHUB/jira-logwork/releases/latest/download/latest.json
```

Ganti `GANTI-USERNAME-GITHUB` dengan username/organisasi GitHub-mu. **Selama
ini belum diganti, auto-update tidak akan berfungsi** dan `npm run release:feed`
akan menolak jalan.

Alamat ini hanya ditulis di satu tempat — skrip feed menurunkan URL unduhan
darinya.

### b. Siapkan repo GitHub

Proyek ini belum di-`git init`. `.gitignore` sudah disiapkan (dan sudah
memblokir `*.key` — lihat poin c).

```bash
git init && git add -A && git commit -m "Initial commit"
gh repo create jira-logwork --public --source=. --push
```

### c. Amankan kunci penandatanganan

```
~/.tauri/jira-logwork.key       ← PRIVAT, jangan pernah di-commit atau dibagikan
~/.tauri/jira-logwork.key.pub   ← publik, sudah ditanam di tauri.conf.json
```

Dua hal yang perlu dipahami, keduanya permanen:

- **Kalau kunci privat hilang**, kamu tidak akan pernah bisa merilis update
  lagi untuk aplikasi yang sudah terpasang di mesin user — mereka harus
  memasang ulang secara manual. Backup ke password manager sekarang.
- **Kalau kunci privat bocor**, pemegangnya bisa mendorong update apa pun ke
  semua mesin user, dan aplikasi akan memasangnya tanpa bertanya. Kunci ini
  setara akses penuh ke laptop setiap user.

Kunci ini dibuat tanpa passphrase supaya build lokal praktis. Menggantinya
dengan kunci ber-passphrase masih bisa dilakukan **sekarang**, tapi tidak lagi
setelah versi pertama dibagikan: aplikasi yang beredar sudah menanam kunci
publik yang lama dan akan menolak update yang ditandatangani kunci baru.

---

## 2. Merilis versi baru

### Langkah 1 — naikkan versi

```bash
npm version 1.0.1 --no-git-tag-version
```

`package.json` adalah satu-satunya sumber versi: `tauri.conf.json` membacanya
lewat `"version": "../package.json"`. Sinkronkan juga versi crate Rust-nya
(kosmetik, tidak memengaruhi bundle):

```bash
sed -i '' 's/^version = ".*"/version = "1.0.1"/' src-tauri/Cargo.toml
```

### Langkah 2 — build kedua platform

Variabel `TAURI_SIGNING_PRIVATE_KEY` wajib ada — isinya boleh berupa **path**
ke file kunci. Namanya membingungkan: perintah `tauri signer generate` ikut
menyebut `TAURI_SIGNING_PRIVATE_KEY_PATH`, tetapi bundler tidak membacanya dan
build akan berhenti dengan *"A public key has been found, but no private key"*.

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/jira-logwork.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

export PATH="/opt/homebrew/opt/llvm/bin:$PATH"   # llvm-rc, untuk build Windows
npm run release:win
npm run release:mac
```

`release:mac` sengaja memakai `--bundles app,dmg`, bukan `dmg` saja. Artefak
updater macOS (`.app.tar.gz`) diturunkan dari target **app**; kalau hanya `dmg`
yang dibangun, build tetap sukses tapi macOS tidak akan punya paket update
sama sekali — Windows jalan, macOS diam.

### Langkah 3 — rakit feed

```bash
npm run release:feed -- --notes "Perbaikan tampilan daftar dan sync"
```

Menghasilkan `latest.json` di root, dan mencetak daftar artefak yang harus
diunggah. Skrip berhenti dengan pesan jelas kalau ada `.sig` yang hilang.

### Langkah 4 — unggah ke GitHub Releases

Tag rilis **harus** `v<versi>` (mis. `v1.0.1`) karena URL unduhan diturunkan
dari situ.

```bash
gh release create v1.0.1 \
  latest.json \
  "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/JIRA Logwork_1.0.1_x64-setup.exe" \
  "src-tauri/target/universal-apple-darwin/release/bundle/macos/JIRA Logwork.app.tar.gz" \
  --title "v1.0.1" --notes "Perbaikan tampilan daftar dan sync"
```

Untuk user baru yang memasang dari nol, sertakan juga `.dmg`-nya. File `.sig`
tidak perlu diunggah — isinya sudah disalin ke dalam `latest.json`.

---

## 3. Cara menguji auto-update

Auto-update tidak bisa diuji lewat `tauri dev` — pengecekan hanya berjalan
pada aplikasi yang sudah dipasang.

1. Rilis `v1.0.0`, pasang di mesin uji.
2. Naikkan ke `1.0.1`, build, rilis `v1.0.1`.
3. Buka aplikasi yang terpasang → banner harus muncul dalam beberapa detik.

Kalau banner tidak muncul, periksa berurutan: apakah `latest.json` bisa diakses
publik lewat browser; apakah `version` di dalamnya lebih tinggi dari versi
terpasang; dan apakah kunci `platforms` cocok (`windows-x86_64`,
`darwin-aarch64`, `darwin-x86_64`).

---

## 4. Catatan penandatanganan OS

Auto-update memakai tanda tangan minisign milik Tauri, yang **berbeda** dan
terpisah dari code-signing sistem operasi. Karena aplikasi ini belum
ditandatangani Apple/Microsoft:

- **Windows** — SmartScreen tetap memperingatkan "Unknown publisher" saat
  installer dijalankan pertama kali.
- **macOS** — Gatekeeper memblokir `.dmg` yang diunduh; lihat catatan di
  `BUILD-WINDOWS.md`.

Ini hanya memengaruhi pemasangan pertama. Update berikutnya lewat mekanisme
auto-update tidak melewati SmartScreen/Gatekeeper.
