#!/usr/bin/env node
// Vendors library logos into gui/logos/ so the GUI makes no external requests at runtime
// (works offline, and nothing phones home while you are picking options).
//
// Only marks that are actually official are downloaded. Hilt and DataStore have no standalone
// logo of their own - they are Android Jetpack libraries - so they get hand-drawn glyphs
// written by this script, and the UI says so rather than passing them off as official.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(toolRoot, 'gui', 'logos');
mkdirSync(outDir, { recursive: true });

// cdn.simpleicons.org serves the official brand glyph as a single-path SVG; the suffix is a
// brand-appropriate colour so the marks stay distinguishable side by side.
const REMOTE = {
  'kotlin.svg':   'https://cdn.simpleicons.org/kotlin/7F52FF',
  'android.svg':  'https://cdn.simpleicons.org/android/3DDC84',
  'compose.svg':  'https://cdn.simpleicons.org/jetpackcompose/4285F4',
  'gradle.svg':   'https://cdn.simpleicons.org/gradle/02303A',
  'square.svg':   'https://cdn.simpleicons.org/square/000000',
  'sqlite.svg':   'https://cdn.simpleicons.org/sqlite/003B57',
  // JetBrains' own asset server, not a third-party redraw.
  'ktor.svg':     'https://resources.jetbrains.com/storage/products/company/brand/logos/Ktor_icon.svg',
  // Koin publishes this on its documentation site.
  'koin.png':     'https://insert-koin.io/img/koin_new_logo.png',
};

// Drawn here, deliberately generic, for the two libraries with no mark of their own.
const LOCAL = {
  'hilt.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2.5l7 7-3.5 3.5-7-7z"/><path d="M11 6L3.5 13.5V21H11l7.5-7.5"/><path d="M8 13l3 3"/></svg>`,
  'datastore.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6.5" rx="1.5"/><rect x="3" y="13.5" width="18" height="6.5" rx="1.5"/><path d="M6.5 7.25h.01M6.5 16.75h.01"/></svg>`,
  'coil.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 106.4 15.3"/><path d="M12 7a5 5 0 103.6 8.5"/><circle cx="12" cy="12" r="1.6" fill="#3DDC84" stroke="none"/></svg>`,
  'glide.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5 21 4l-6.5 16.5-2.8-6.2z"/><path d="M11.7 14.3 21 4"/></svg>`,
  'sqldelight.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8"/><path d="M19.5 5.5v6"/><path d="M17 15.5l-2.5 3h4l-2.5 3"/></svg>`,
  'none.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>`,
};

async function download(name, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'android-kickstart' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/image\/(svg\+xml|png)/.test(type)) throw new Error(`unexpected content-type ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error(`suspiciously small (${buf.length} bytes)`);
  writeFileSync(join(outDir, name), buf);
  return `${buf.length} bytes, ${type}`;
}

let failed = 0;
for (const [name, body] of Object.entries(LOCAL)) {
  writeFileSync(join(outDir, name), body, 'utf8');
  console.log(`drawn     ${name.padEnd(16)} (no official mark exists)`);
}
for (const [name, url] of Object.entries(REMOTE)) {
  try {
    console.log(`fetched   ${name.padEnd(16)} ${await download(name, url)}`);
  } catch (e) {
    failed++;
    console.log(`FAILED    ${name.padEnd(16)} ${e.message}  <- ${url}`);
  }
}
process.exit(failed ? 1 : 0);
