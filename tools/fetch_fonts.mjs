#!/usr/bin/env node
// Vendors the two UI fonts into gui/fonts/ so the GUI renders identically offline and makes
// no request to fonts.gstatic.com at runtime. Only the `latin` subset is kept - Google serves
// ~30 subset blocks per family and the rest are dead weight for this tool.

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(toolRoot, 'gui', 'fonts');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) unlinkSync(join(outDir, f));

// Roboto and Roboto Mono are Material Design 3's own typefaces - using anything else makes
// the type scale approximate rather than faithful.
const CSS_URL = 'https://fonts.googleapis.com/css2'
  + '?family=Roboto:wght@400;500;700'
  + '&family=Roboto+Mono:wght@400;500'
  + '&display=swap';

// A modern browser UA is required or Google serves legacy .ttf instead of .woff2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

// Each @font-face is preceded by a `/* subset */` comment; keep only latin.
const blocks = css.split('/*').slice(1).map((b) => '/*' + b);
const latin = blocks.filter((b) => /^\/\*\s*latin\s*\*\//.test(b));
if (!latin.length) throw new Error('no latin subset blocks found - Google CSS format changed');

const byHash = new Map();   // file bytes hash -> { file, family, weights[] }
let downloaded = 0;

for (const block of latin) {
  const family = (block.match(/font-family:\s*'([^']+)'/) ?? [])[1];
  const weight = (block.match(/font-weight:\s*(\d+)/) ?? [])[1];
  const url = (block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/) ?? [])[1];
  if (!family || !weight || !url) continue;

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${family} ${weight}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`${family} ${weight}: suspiciously small (${buf.length} bytes)`);

  // Google serves ONE variable file per family and repeats it for every requested weight.
  // Storing it once and declaring a weight range avoids shipping the same bytes three times.
  const hash = createHash('md5').update(buf).digest('hex');
  const existing = byHash.get(hash);
  if (existing) {
    existing.weights.push(Number(weight));
    continue;
  }

  const file = `${family.replace(/\s+/g, '')}.woff2`;
  writeFileSync(join(outDir, file), buf);
  byHash.set(hash, { file, family, weights: [Number(weight)] });
  downloaded++;
  console.log(`${file.padEnd(24)} ${buf.length} bytes`);
}

let out = '/* Vendored from Google Fonts (latin subset). Regenerate: npm run fonts */\n';
for (const { file, family, weights } of byHash.values()) {
  const range = weights.length > 1 ? `${Math.min(...weights)} ${Math.max(...weights)}` : String(weights[0]);
  out += `@font-face{font-family:'${family}';font-style:normal;font-weight:${range};`
    + `font-display:swap;src:url('/fonts/${file}') format('woff2');}\n`;
}
writeFileSync(join(outDir, 'fonts.css'), out, 'utf8');
console.log(`\nfonts.css written — ${downloaded} file(s), ${byHash.size} family(ies)`);
