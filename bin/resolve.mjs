#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAll, checkConstraints, verifyPluginMarker } from '../src/resolver.mjs';
import { renderVersionCatalog } from '../src/toml.mjs';
import { C } from '../src/color.mjs';

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'));
const compat = JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const has = (name) => argv.includes(`--${name}`);

const choices = {
  ui: flag('ui', 'compose'),
  di: flag('di', 'hilt'),
  network: flag('network', 'retrofit'),
  db: flag('db', 'room'),
};

const keys = [...new Set([
  ...catalog.profiles.base,
  ...(catalog.profiles.ui[choices.ui] ?? []),
  ...(catalog.profiles.di[choices.di] ?? []),
  ...(catalog.profiles.network[choices.network] ?? []),
  ...(catalog.profiles.db[choices.db] ?? []),
])];


const t0 = Date.now();
console.log(`${C.bold}android-kickstart${C.off} ${C.dim}resolving ${keys.length} artifacts${C.off}`);
console.log(`${C.dim}  ui=${choices.ui} di=${choices.di} network=${choices.network} db=${choices.db}${C.off}\n`);

let results, errors;
if (has('offline')) {
  const pinned = JSON.parse(readFileSync(join(root, 'pinned.json'), 'utf8'));
  results = Object.fromEntries(keys.filter((k) => pinned.versions[k]).map((k) => [k, {
    key: k, version: pinned.versions[k], repo: 'pinned', tag: catalog.artifacts[k]?.tag,
    derivedFrom: catalog.artifacts[k]?.derivedFrom,
  }]));
  errors = keys.filter((k) => !pinned.versions[k]).map((k) => ({ key: k, error: 'not in pinned.json' }));
  console.log(`${C.yellow}offline mode${C.off} ${C.dim}using pinned.json from ${pinned.pinnedAt}${C.off}\n`);
} else {
  ({ results, errors } = await resolveAll(keys, catalog, { includePrerelease: has('include-prerelease') }));
}

const pad = (s, n) => String(s).padEnd(n);
const byTag = {};
for (const r of Object.values(results)) (byTag[r.tag ?? 'other'] ??= []).push(r);

for (const tag of Object.keys(byTag).sort()) {
  console.log(`${C.cyan}[${tag}]${C.off}`);
  for (const r of byTag[tag].sort((a, b) => a.key.localeCompare(b.key))) {
    const skipped = r.skippedPrerelease ? `${C.dim}  (skipped prerelease ${r.newestAny})${C.off}` : '';
    const src = r.derivedFrom ? `${C.dim}derived${C.off}` : `${C.dim}${r.repo}${C.off}`;
    console.log(`  ${pad(r.key, 26)} ${C.green}${pad(r.version, 14)}${C.off} ${src}${skipped}`);
  }
  console.log('');
}

if (errors.length) {
  console.log(`${C.red}unresolved:${C.off}`);
  for (const e of errors) console.log(`  ${pad(e.key, 26)} ${C.red}${e.error}${C.off} ${C.dim}${e.coordinates ?? ''}${C.off}`);
  console.log('');
}

const warnings = checkConstraints(results, compat);
if (warnings.length) {
  console.log(`${C.bold}constraints${C.off} ${C.dim}(no HTTP endpoint answers these)${C.off}`);
  for (const w of warnings) {
    const c = w.level === 'warn' ? C.yellow : C.dim;
    console.log(`  ${c}${w.level === 'warn' ? '!' : 'i'} ${w.msg}${C.off}`);
  }
  console.log('');
}

if (has('verify-plugins')) {
  console.log(`${C.bold}plugin markers${C.off}`);
  for (const key of keys) {
    const spec = catalog.artifacts[key];
    if (!spec?.pluginId || !results[key]) continue;
    const ref = spec.pluginVersionRef ?? key;
    const wanted = results[ref]?.version;
    if (!wanted) continue;
    const v = await verifyPluginMarker(spec.pluginId, wanted, spec.pluginRepos);
    const ok = v.present ? `${C.green}ok${C.off}` : `${C.red}MISSING${C.off}`;
    const extra = v.staleMirrors?.length ? `${C.yellow} <- ${v.staleMirrors.join(', ')}${C.off}` : '';
    const refNote = ref !== key ? `${C.dim} (ref: ${ref})${C.off}` : '';
    console.log(`  ${pad(spec.pluginId, 42)} ${pad(wanted, 14)} ${ok} ${C.dim}${v.repo ?? 'none'}${C.off}${refNote}${extra}`);
  }
  console.log('');
}

if (has('pin') && !errors.length) {
  const pinned = { pinnedAt: new Date().toISOString(), versions: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.version])) };
  writeFileSync(join(root, 'pinned.json'), JSON.stringify(pinned, null, 2) + '\n', 'utf8');
  console.log(`${C.green}pinned${C.off} ${Object.keys(pinned.versions).length} versions to pinned.json\n`);
}

const toml = renderVersionCatalog(results);
const outDir = flag('out', null);
if (outDir) {
  mkdirSync(join(outDir, 'gradle'), { recursive: true });
  const p = join(outDir, 'gradle', 'libs.versions.toml');
  writeFileSync(p, toml, 'utf8');
  console.log(`${C.green}wrote${C.off} ${p}`);
} else if (has('print-toml')) {
  console.log(`${C.bold}gradle/libs.versions.toml${C.off}\n`);
  console.log(toml);
}

console.log(`${C.dim}resolved in ${Date.now() - t0}ms${C.off}`);
process.exit(errors.length ? 1 : 0);
