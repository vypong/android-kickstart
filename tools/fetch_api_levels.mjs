#!/usr/bin/env node
// Vendors the Android API level table from endoflife.date so the minSdk picker shows real
// version names and support status instead of bare numbers. Run: npm run api-levels

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://endoflife.date/api/android.json';

const raw = await (await fetch(SOURCE, { headers: { 'User-Agent': 'android-kickstart' } })).json();
if (!Array.isArray(raw) || !raw.length) throw new Error('unexpected payload from endoflife.date');

const levels = raw
  .map((r) => ({
    api: Number(r.apiVersion),
    version: String(r.cycle),
    codename: r.codename || null,
    releaseDate: r.releaseDate || null,
    // `eol` is either false (still supported) or an ISO date it ended / will end.
    eol: r.eol === false ? null : r.eol,
  }))
  // Below 21 is not a realistic minSdk any more, and multi-API rows parse as NaN.
  .filter((r) => Number.isInteger(r.api) && r.api >= 21)
  .sort((a, b) => b.api - a.api);

const out = {
  _source: SOURCE,
  _fetchedAt: new Date().toISOString().slice(0, 10),
  _link: 'https://endoflife.date/android',
  levels,
};

writeFileSync(join(toolRoot, 'android-api-levels.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`wrote ${levels.length} API levels (${levels[levels.length - 1].api}-${levels[0].api})`);
for (const l of levels.slice(0, 4)) {
  console.log(`  API ${l.api}  Android ${l.version}  ${l.codename ?? ''}`);
}
