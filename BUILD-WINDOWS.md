# Build JIRA Logwork

Panduan build untuk Windows dan macOS.

Untuk **Windows** ada dua jalur: build langsung **di Windows** (paling andal)
atau **cross-compile dari macOS** (lebih cepat kalau mesin harianmu Mac).
Keduanya menghasilkan installer NSIS yang sama. Panduan **macOS** ada di bagian
paling bawah.

---

## Cross-compile dari macOS

Tauri menandai jalur ini "experimental" — hasilnya tetap `.exe` x64 yang valid,
tetapi installer **tidak ditandatangani** (di Windows host pun perlu sertifikat
terpisah), jadi Windows SmartScreen akan menampilkan peringatan "Unknown
publisher" saat pertama dijalankan.

### Prasyarat (sekali saja)

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin   # menyediakan MSVC SDK + linker
brew install makensis               # bundler installer NSIS
brew install llvm                   # menyediakan llvm-rc (WAJIB, lihat catatan)
```

`llvm-rc` sering terlewat: `tauri-winres` memakainya untuk mengompilasi resource
Windows (ikon + info versi) ke dalam `.exe`. Tanpa itu build gagal di build
script dengan `called Result::unwrap() on an Err value: NotAttempted("llvm-rc")`.
Homebrew tidak menautkan LLVM ke PATH global, jadi harus ditambahkan manual saat
build — lihat perintah di bawah.

### Perintah build

```bash
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

Build pertama ~20–30 menit (unduh Windows SDK + kompilasi seluruh dependensi
Rust dari nol) dan butuh ruang disk sekitar 8 GB. Build berikutnya beberapa menit
karena dependensinya ter-cache.

### Hasil

```
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/JIRA Logwork_0.1.0_x64-setup.exe
src-tauri/target/x86_64-pc-windows-msvc/release/jira-logwork.exe   (binary polos, tanpa installer)
```

---

## Build langsung di Windows

## Prasyarat

1. **Node.js** (LTS)
   - Download: https://nodejs.org/
   - Jalankan installer, next-next-finish.
   - Verifikasi: buka PowerShell, ketik `node --version`

2. **Rust**
   - Download: https://rustup.rs/ → klik "rustup-init.exe"
   - Saat ditanya, pilih default (option 1).
   - Restart terminal setelah install.
   - Verifikasi: `rustc --version`

3. **Visual Studio Build Tools** (biasanya otomatis terinstall oleh rustup)
   - Kalau build gagal dengan error "link.exe not found":
     - Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
     - Install dengan workload "Desktop development with C++"

## Langkah Build

1. Extract `jira-logwork-source.zip` ke folder mana pun (misal `C:\Projects\jira-logwork\`)

2. Buka PowerShell / Command Prompt, masuk ke folder:
   ```
   cd C:\Projects\jira-logwork
   ```

3. Install dependencies Node.js:
   ```
   npm install
   ```

4. Build aplikasi:
   ```
   npm run tauri build
   ```

5. Tunggu ~5-10 menit (pertama kali agak lama karena compile Rust).

## Hasil

Installer Windows ada di:
```
src-tauri\target\release\bundle\nsis\JIRA Logwork_0.1.0_x64-setup.exe
```

File `.exe` ini yang Anda distribusikan ke user Windows.
User double-click → ikuti wizard → aplikasi terinstall di Start Menu.

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `npm: command not found` | Node.js belum terinstall atau PATH belum di-reload. Restart terminal. |
| `rustc: command not found` | Rust belum terinstall. Jalankan rustup-init.exe lagi. |
| `link.exe not found` | Install Visual Studio Build Tools dengan workload C++. |
| Build timeout / OOM | Pastikan RAM minimal 8 GB dan disk kosong minimal 5 GB. |
| `error: failed to download` | Pastikan internet stabil — Cargo perlu download dependencies Rust pertama kali. |

---

## Build macOS

### Hanya untuk Mac ini (paling cepat)

```bash
npm install
npm run tauri build
```

Hasilnya menyasar arsitektur host saja:
```
src-tauri/target/release/bundle/dmg/JIRA Logwork_0.1.0_aarch64.dmg
```

### Universal — jalan di Intel & Apple Silicon (untuk dibagikan)

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # sekali saja
npm run tauri build -- --target universal-apple-darwin --bundles dmg
```

```
src-tauri/target/universal-apple-darwin/release/bundle/dmg/JIRA Logwork_0.1.0_universal.dmg
```

Kompilasinya dua kali (satu per arsitektur) lalu digabung dengan `lipo`, jadi
sekitar dua kali lebih lama dari build biasa.

### Gatekeeper: aplikasi tidak bertanda tangan

Tanpa sertifikat Apple Developer (`security find-identity -v -p codesigning`
kosong), `.app` hanya ditandatangani ad-hoc. Begitu `.dmg` diunduh lewat
browser/chat, macOS memberi atribut karantina dan menolak membukanya dengan
pesan **"aplikasi rusak dan tidak dapat dibuka"** — menyesatkan, karena file-nya
sebenarnya baik-baik saja.

Penerima bisa membukanya dengan salah satu cara:

```bash
# Setelah menyeret aplikasi ke /Applications
xattr -cr "/Applications/JIRA Logwork.app"
```

atau klik kanan aplikasinya → **Open** → **Open** lagi di dialog peringatan.
Menyalin `.dmg` lewat USB/AirDrop biasanya tidak memicu karantina.

Untuk distribusi tanpa langkah manual ini diperlukan akun Apple Developer
(berbayar) untuk signing + notarization.
