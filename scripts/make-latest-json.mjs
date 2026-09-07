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

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

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
    match: (f) => f.endsWith("-setup.exe"),
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

for (const t of targets) {
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
  const signature = readFileSync(sigPath, "utf8").trim();
  const fileName = artifact.split("/").pop();
  for (const key of t.keys) {
    platforms[key] = {
      signature,
      url: `${downloadBase}/${encodeURIComponent(fileName)}`,
    };
  }
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
