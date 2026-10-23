#!/usr/bin/env node
/**
 * Merakit `latest.json` — feed yang dibaca aplikasi untuk tahu ada versi baru.
 *
 * Tauri menghasilkan artefak update beserta file `.sig`-nya, tetapi tidak
 * merakit feed-nya (di CI, `tauri-action` yang melakukan ini). Karena rilis
 * di sini dibuat lokal, skrip ini mengumpulkannya:
 *
 *   - Windows : `*-setup.exe` + `.sig`   (target NSIS)
 *   - macOS   : `*.app.tar.gz` + `.sig`  (universal → dipakai Intel & ARM)
 *
 * URL unduhan diturunkan dari `plugins.updater.endpoints` di
 * `tauri.conf.json`, jadi alamat repo cukup ditulis di satu tempat saja.
 *
 * Pemakaian:
 *   node scripts/make-latest-json.mjs [--notes "Catatan rilis"]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

// --- Platform allowlist --------------------------------------------------
// `--platforms win,mac` membatasi platform mana yang masuk feed. Default:
// semua platform yang artefaknya ada. Ini kontrak eksplisit terhadap jebakan
// "rilis satu OS tapi feed diam-diam menyertakan artefak OS lain yang basi":
// saat kamu hanya build Windows, jalankan dengan `--platforms win` agar entri
// macOS lama tidak pernah ikut.
const platformsFlag = process.argv.indexOf("--platforms");
const platformFilterRaw =
  platformsFlag !== -1 ? (process.argv[platformsFlag + 1] ?? "") : "all";
const PLATFORM_ALIASES = {
  win: ["windows-x86_64"],
  windows: ["windows-x86_64"],
  mac: ["darwin-x86_64", "darwin-aarch64"],
  macos: ["darwin-x86_64", "darwin-aarch64"],
  darwin: ["darwin-x86_64", "darwin-aarch64"],
};
const allowedKeys =
  platformFilterRaw === "all" || platformFilterRaw === ""
    ? null // null = semua
    : new Set(
        platformFilterRaw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .flatMap((name) => {
            const keys = PLATFORM_ALIASES[name];
            if (!keys) {
              console.error(
                `Platform "${name}" tidak dikenal. Pakai: win, mac (atau "all").`,
              );
              process.exit(1);
            }
            return keys;
          }),
      );

// --- Alamat repo, diambil dari endpoint updater -------------------------
const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? "";
const m = endpoint.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\//);
if (!m) {
  console.error(
    `Tidak bisa membaca owner/repo dari endpoint updater:\n  ${endpoint}\n` +
      `Perbaiki dulu "plugins.updater.endpoints" di src-tauri/tauri.conf.json.`,
  );
  process.exit(1);
}
const [, owner, repo] = m;
if (owner.startsWith("GANTI-")) {
  console.error(
    `Endpoint updater masih memakai placeholder ("${owner}").\n` +
      `Ganti dengan username GitHub kamu di src-tauri/tauri.conf.json.`,
  );
  process.exit(1);
}
const downloadBase = `https://github.com/${owner}/${repo}/releases/download/v${version}`;

// --- Cari artefak + tanda tangannya -------------------------------------
/**
 * Nama aset sebagaimana GitHub menyimpannya.
 *
 * GitHub menormalkan nama file rilis: karakter di luar `[A-Za-z0-9._-]`
 * diganti titik. `productName` di sini mengandung spasi, jadi
 * "JIRA Logwork_1.0.0_x64-setup.exe" terunggah sebagai
 * "JIRA.Logwork_1.0.0_x64-setup.exe". Memakai nama lokal apa adanya membuat
 * URL di feed 404 — feed-nya sendiri tetap terbaca, sehingga kegagalannya
 * baru muncul saat user menekan tombol Update.
 */
function githubAssetName(fileName) {
  return fileName.replace(/[^A-Za-z0-9._-]/g, ".");
}

/** Cari satu file yang cocok `pred` di dalam `dir`; null bila tidak ada. */
function findIn(dir, pred) {
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find(pred);
  return hit ? join(dir, hit) : null;
}

const targets = [
  {
    keys: ["windows-x86_64"],
    dir: join(ROOT, "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"),
    // Terikat versi: build lama tetap tertinggal di folder ini, dan tanpa
    // pengikatan ini feed bisa menunjuk installer versi sebelumnya.
    match: (f) => f.includes(`_${version}_`) && f.endsWith("-setup.exe"),
    label: "Windows (NSIS)",
  },
  {
    // Satu bundle universal melayani kedua arsitektur macOS.
    keys: ["darwin-x86_64", "darwin-aarch64"],
    dir: join(ROOT, "src-tauri/target/universal-apple-darwin/release/bundle/macos"),
    match: (f) => f.endsWith(".app.tar.gz"),
    label: "macOS (universal)",
  },
];

const platforms = {};
const missing = [];
const skipped = [];

// Artefak yang lebih tua dari ambang ini (relatif ke sekarang) dianggap sisa
// build lama, bukan bagian dari rilis saat ini. Nama bundle macOS tidak
// memuat versi (`JIRA Logwork.app.tar.gz`), jadi mtime adalah satu-satunya
// sinyal untuk membedakan artefak segar dari yang basi. 6 jam memberi ruang
// untuk build lama/berurutan tanpa menangkap artefak rilis sebelumnya.
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const now = Date.now();

for (const t of targets) {
  // Hormati allowlist platform: lewati target yang tidak diminta.
  if (allowedKeys && !t.keys.some((k) => allowedKeys.has(k))) {
    skipped.push(`${t.label}: dilewati (tidak ada di --platforms)`);
    continue;
  }

  const artifact = findIn(t.dir, t.match);
  if (!artifact) {
    missing.push(`${t.label}: tidak ada artefak di ${t.dir}`);
    continue;
  }
  const sigPath = `${artifact}.sig`;
  if (!existsSync(sigPath)) {
    missing.push(
      `${t.label}: ada artefak tapi tanpa ${sigPath.split("/").pop()} — ` +
        `build dijalankan tanpa TAURI_SIGNING_PRIVATE_KEY?`,
    );
    continue;
  }

  // Jaring pengaman staleness: artefak jauh lebih tua dari build saat ini
  // hampir pasti sisa rilis sebelumnya. Menyertakannya akan menautkan feed
  // ke binari lama dengan signature yang tidak cocok untuk versi ini —
  // persis bug yang membuat update macOS gagal. Jangan diam-diam disertakan.
  const ageMs = now - statSync(artifact).mtimeMs;
  if (ageMs > STALE_THRESHOLD_MS) {
    const hours = (ageMs / 3_600_000).toFixed(1);
    missing.push(
      `${t.label}: artefak berumur ${hours} jam — tampak basi (sisa build lama). ` +
        `Build ulang platform ini untuk v${version}, atau kecualikan lewat --platforms.`,
    );
    continue;
  }

  const signature = readFileSync(sigPath, "utf8").trim();
  const fileName = artifact.split("/").pop();
  for (const key of t.keys) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    platforms[key] = {
      signature,
      url: `${downloadBase}/${githubAssetName(fileName)}`,
    };
  }
}

if (skipped.length > 0) {
  console.log("Dilewati sesuai --platforms:\n  - " + skipped.join("\n  - ") + "\n");
}

if (missing.length > 0) {
  console.error("Artefak update belum lengkap:\n  - " + missing.join("\n  - "));
  // Tetap tulis feed untuk platform yang ada: rilis khusus satu OS itu sah,
  // dan aplikasi di OS lain akan diam saja karena kuncinya tidak ada.
  if (Object.keys(platforms).length === 0) process.exit(1);
}

const notesFlag = process.argv.indexOf("--notes");
const notes = notesFlag !== -1 ? process.argv[notesFlag + 1] : `Rilis v${version}`;

const out = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

const outPath = join(ROOT, "latest.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

console.log(`latest.json ditulis untuk v${version}`);
for (const key of Object.keys(platforms)) {
  console.log(`  ${key} -> ${decodeURIComponent(platforms[key].url.split("/").pop())}`);
}
console.log(`\nUnggah ke rilis bertag v${version}:`);
console.log(`  latest.json + setiap artefak di atas (beserta file .sig-nya tidak perlu).`);
