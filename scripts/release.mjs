#!/usr/bin/env node
/**
 * Menyiapkan rilis versi baru: naikkan versi, build kedua platform, rakit
 * feed updater, lalu verifikasi hasilnya.
 *
 * Skrip ini sengaja BERHENTI sebelum menerbitkan. Ia mencetak perintah
 * `git commit` dan `gh release create` untuk kamu jalankan sendiri —
 * penerbitan ke publik tidak boleh menjadi efek samping sebuah skrip.
 *
 * Pemakaian:
 *   npm run release -- 1.0.2
 *   npm run release -- 1.0.2 --notes "Ringkasan perubahan"
 *
 * Setiap pemeriksaan di sini pernah benar-benar gagal di project ini.
 * Kegagalan-kegagalan itu punya sifat yang sama: build tetap "sukses",
 * rilisnya terlihat normal di halaman GitHub, dan yang rusak baru ketahuan
 * di mesin pengguna saat menekan tombol Update. Karena itu pemeriksaannya
 * dilakukan di sini, bukan diserahkan ke mata.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const SIGNING_KEY = join(homedir(), ".tauri/jira-logwork.key");

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function die(msg, hint) {
  console.error(`\n${c.red("Berhenti:")} ${msg}`);
  if (hint) console.error(c.dim(`  ${hint}`));
  process.exit(1);
}
function step(msg) {
  console.log(`\n${c.bold("→")} ${msg}`);
}
function ok(msg) {
  console.log(`  ${c.green("✓")} ${msg}`);
}
function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
}

// --- Argumen -------------------------------------------------------------

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const notesIdx = args.indexOf("--notes");
const notes = notesIdx !== -1 ? args[notesIdx + 1] : null;

if (!version) {
  die(
    "versi belum diberikan.",
    'Contoh: npm run release -- 1.0.2 --notes "Ringkasan perubahan"',
  );
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  die(`versi "${version}" tidak berbentuk X.Y.Z.`);
}

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

const rank = (v) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
if (rank(version) <= rank(current)) {
  die(
    `versi ${version} tidak lebih tinggi dari ${current}.`,
    "Updater membandingkan nomor versi, bukan isi paket. Versi yang sama " +
      "atau lebih rendah tidak akan pernah memicu pembaruan.",
  );
}

// --- Pemeriksaan sebelum build ------------------------------------------

step(`Memeriksa prasyarat (${current} → ${version})`);

if (sh("git status --porcelain")) {
  die(
    "masih ada perubahan yang belum di-commit.",
    "Tag rilis harus menunjuk ke commit yang isinya persis seperti yang " +
      "di-build. Commit dulu, lalu jalankan ulang.",
  );
}
ok("working tree bersih");

if (!existsSync(SIGNING_KEY)) {
  die(
    `kunci penandatanganan tidak ada di ${SIGNING_KEY}.`,
    "Tanpa ini build tetap jalan tapi tidak menghasilkan .sig, dan updater " +
      "akan menolak setiap paket.",
  );
}
ok("kunci penandatanganan ada");

// `llvm-rc` dibutuhkan bundler NSIS. Tanpa ini build Windows berhenti
// dengan NotAttempted("llvm-rc") setelah kompilasi Rust selesai.
const llvmBin = ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"].find(
  (p) => existsSync(join(p, "llvm-rc")),
);
if (!llvmBin) {
  die("llvm-rc tidak ditemukan.", "Pasang dengan: brew install llvm");
}
ok(`llvm-rc ada (${llvmBin})`);

const conf = JSON.parse(
  readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
);
const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? "";
const repoMatch = endpoint.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\//);
if (!repoMatch || repoMatch[1].startsWith("GANTI-")) {
  die("endpoint updater di tauri.conf.json belum menunjuk repo sungguhan.");
}
ok(`endpoint updater → ${repoMatch[1]}/${repoMatch[2]}`);

const tag = `v${version}`;
let tagExists = false;
try {
  execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
  tagExists = true;
} catch {
  /* belum ada — yang kita harapkan */
}
if (tagExists) {
  die(
    `rilis ${tag} sudah ada di GitHub.`,
    "Menimpanya akan mengganti paket yang mungkin sudah diunduh pengguna.",
  );
}
ok(`tag ${tag} belum dipakai`);

// --- Naikkan versi -------------------------------------------------------

step(`Menaikkan versi ke ${version}`);

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
ok("package.json");

const cargoPath = join(ROOT, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(
  cargoPath,
  cargo.replace(/^version = ".*"$/m, `version = "${version}"`),
);
ok("Cargo.toml");

// Cargo.lock ikut menyimpan versi crate. Kalau dibiarkan tertinggal, build
// akan memperbaruinya di tengah jalan dan menghasilkan diff tak terduga.
sh("cargo check --quiet", { cwd: join(ROOT, "src-tauri"), stdio: "ignore" });
ok("Cargo.lock");

// --- Build ---------------------------------------------------------------

// Dicatat sebelum build supaya kesegaran artefak bisa diperiksa nanti.
const buildStart = Date.now();

const env = {
  ...process.env,
  // WAJIB nama ini. Ada varian ..._PATH yang namanya lebih masuk akal dan
  // bahkan disebut oleh `tauri signer generate`, tetapi bundler tidak
  // membacanya: build berhenti dengan "A public key has been found, but no
  // private key".
  TAURI_SIGNING_PRIVATE_KEY: SIGNING_KEY,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  PATH: `${llvmBin}:${process.env.PATH}`,
};

step("Build Windows (beberapa menit)");
execSync("npm run release:win", { cwd: ROOT, env, stdio: "inherit" });

step("Build macOS universal (beberapa menit)");
execSync("npm run release:mac", { cwd: ROOT, env, stdio: "inherit" });

// --- Verifikasi artefak --------------------------------------------------

step("Memeriksa artefak");

const winExe = join(
  ROOT,
  `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/JIRA Logwork_${version}_x64-setup.exe`,
);
const macTar = join(
  ROOT,
  "src-tauri/target/universal-apple-darwin/release/bundle/macos/JIRA Logwork.app.tar.gz",
);
const macDmg = join(
  ROOT,
  `src-tauri/target/universal-apple-darwin/release/bundle/dmg/JIRA Logwork_${version}_universal.dmg`,
);

for (const [label, p] of [
  ["installer Windows", winExe],
  ["paket update macOS", macTar],
  ["installer macOS", macDmg],
]) {
  if (!existsSync(p)) die(`${label} tidak terbentuk: ${p}`);

  // Kesegaran, bukan sekadar keberadaan. `JIRA Logwork.app.tar.gz` tidak
  // mengandung nomor versi, jadi sisa build lama dengan nama identik akan
  // lolos pemeriksaan "ada" dan diam-diam masuk ke feed — tanda tangannya
  // tidak akan cocok dengan paket yang diunduh pengguna.
  if (statSync(p).mtimeMs < buildStart) {
    die(
      `${label} lebih tua dari build barusan: ${p}`,
      "Artefak ini sisa build sebelumnya, bukan hasil build ini.",
    );
  }
  ok(`${label} (${(statSync(p).size / 1048576).toFixed(1)} MB)`);
}

for (const [label, p] of [
  ["Windows", `${winExe}.sig`],
  ["macOS", `${macTar}.sig`],
]) {
  if (!existsSync(p)) {
    die(
      `tanda tangan updater ${label} tidak terbentuk.`,
      "Build sukses tanpa .sig berarti kuncinya tidak terbaca — pengguna " +
        "tidak akan pernah bisa memperbarui.",
    );
  }
  ok(`tanda tangan ${label}`);
}

// --- Feed ----------------------------------------------------------------

step("Merakit latest.json");
execSync(
  `node scripts/make-latest-json.mjs${notes ? ` --notes ${JSON.stringify(notes)}` : ""}`,
  { cwd: ROOT, stdio: "inherit" },
);

const feed = JSON.parse(readFileSync(join(ROOT, "latest.json"), "utf8"));
if (feed.version !== version) {
  die(`latest.json menyebut versi ${feed.version}, bukan ${version}.`);
}

// Tanda tangan di feed harus benar-benar milik artefak yang akan diunggah,
// bukan milik file bernama sama di direktori target lain.
const expectMac = readFileSync(`${macTar}.sig`, "utf8").trim();
const expectWin = readFileSync(`${winExe}.sig`, "utf8").trim();
for (const [key, expect] of [
  ["darwin-aarch64", expectMac],
  ["darwin-x86_64", expectMac],
  ["windows-x86_64", expectWin],
]) {
  if (feed.platforms[key]?.signature !== expect) {
    die(
      `tanda tangan ${key} di latest.json tidak cocok dengan artefak yang akan diunggah.`,
      "Feed kemungkinan mengambil artefak dari build lama.",
    );
  }
}
ok("tanda tangan di feed cocok dengan artefak");

for (const [key, v] of Object.entries(feed.platforms)) {
  if (!v.url.includes(`/${tag}/`)) {
    die(`URL ${key} tidak menunjuk tag ${tag}: ${v.url}`);
  }
}
ok(`semua URL menunjuk ${tag}`);

// --- Langkah terakhir, dijalankan manual ---------------------------------

const q = (p) => `"${p.replace(ROOT, "")}"`;
const notesArg = notes ?? `Rilis ${tag}`;

console.log(`\n${c.green(c.bold(`Siap dirilis: ${tag}`))}\n`);
console.log("Dua perintah terakhir sengaja tidak dijalankan otomatis —");
console.log("keduanya mengubah sesuatu di luar mesin ini.\n");
console.log(c.dim("  # 1. Simpan kenaikan versi + feed"));
console.log(`  git add -A && git commit -m ${JSON.stringify(`Bump version to ${version}`)} && git push\n`);
console.log(c.dim("  # 2. Terbitkan rilis"));
console.log(
  `  gh release create ${tag} \\\n` +
    `    latest.json \\\n` +
    `    ${q(winExe)} \\\n` +
    `    ${q(macTar)} \\\n` +
    `    ${q(macDmg)} \\\n` +
    `    --title ${JSON.stringify(tag)} --notes ${JSON.stringify(notesArg)}\n`,
);
