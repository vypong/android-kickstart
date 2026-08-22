#!/usr/bin/env node
// Snapshots the current versions of EVERY artifact in the catalog as the offline fallback.
//
// Pinning only the artifacts of one profile is how pinned.json goes stale: add a new option,
// forget to re-pin with that option selected, and --offline breaks for whoever picks it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAll, resolveAndroidPlatform } from '../src/resolver.mjs';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(toolRoot, 'catalog.json'), 'utf8'));

const keys = Object.keys(catalog.artifacts);
console.log(`resolving all ${keys.length} artifacts…`);

const { results, errors } = await resolveAll(keys, catalog, {});

if (errors.length) {
  console.error('\ncould not resolve, refusing to write a partial pin:');
  for (const e of errors) console.error(`  ${e.key}: ${e.error}`);
  process.exit(1);
}

let platform = {};
try {
  platform = await resolveAndroidPlatform();
} catch (e) {
  console.error(`could not read the SDK manifest: ${e.message}`);
  process.exit(1);
}

const versions = Object.fromEntries(
  Object.entries(results).sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [k, r.version])
);

writeFileSync(
  join(toolRoot, 'pinned.json'),
  JSON.stringify({
    pinnedAt: new Date().toISOString(),
    compileSdk: platform.compileSdk,
    buildTools: platform.buildTools,
    versions,
  }, null, 2) + '\n',
  'utf8'
);

console.log(`pinned ${Object.keys(versions).length} artifacts, compileSdk ${platform.compileSdk}`);
for (const k of ['agp', 'kotlin', 'composeBom']) console.log(`  ${k.padEnd(12)} ${versions[k]}`);
