#!/usr/bin/env node
// Scaffolds real projects into a temp dir and checks the FILES THAT ACTUALLY GET WRITTEN for
// identifiers that should not survive that configuration.
//
// Auditing templates directly would be wrong: most are conditionally emitted, so a Room DAO
// "leaking" in a SQLDelight build is meaningless if that template is never written. This
// catches the real bug class - a guard inside an emitted file silently failing to apply.

import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../src/scaffold.mjs';
import { renderVersionCatalog } from '../src/toml.mjs';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(toolRoot, 'catalog.json'), 'utf8'));

// Only the artifacts this configuration would actually resolve - feeding the whole pinned set
// would put Room in a SQLDelight project's catalog and report a leak that never happens.
function resolvedFor(cfg) {
  const keys = new Set([
    ...catalog.profiles.base,
    ...catalog.profiles.ui.compose,
    ...(catalog.profiles.di[cfg.di] ?? []),
    ...(catalog.profiles.network[cfg.network] ?? []),
    ...(catalog.profiles.db[cfg.db] ?? []),
    ...(catalog.profiles.prefs[cfg.prefs] ?? []),
    ...(catalog.profiles.image[cfg.image] ?? []),
  ]);
  for (const [k, spec] of Object.entries(catalog.artifacts)) {
    if (spec.derivedFrom && keys.has(spec.derivedFrom)) keys.add(k);
  }
  return Object.fromEntries(
    [...keys].filter((k) => pinned.versions[k]).map((k) => [k, { key: k, version: pinned.versions[k] }])
  );
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const baseConfig = {
  appName: 'Audit', packageName: 'com.audit.app', minSdk: 24, compileSdk: 37, targetSdk: 37,
  javaVersion: '17', gradleVersion: '9.5.0', sdkDir: null,
};

const ITEM_TYPES = [/\bItemRepository\b/, /\bItemDao\b/, /\bItemEntity\b/, /\bItemQueries\b/, /\bmodel\.Item\b/];

const CASES = [
  { name: 'hilt · no store',      cfg: { di: 'hilt', network: 'retrofit', db: 'none', prefs: 'datastore', image: 'coil', sample: 'yes' }, forbidden: ITEM_TYPES },
  { name: 'koin · no store',      cfg: { di: 'koin', network: 'ktor', db: 'none', prefs: 'datastore', image: 'none', sample: 'yes' }, forbidden: ITEM_TYPES },
  { name: 'none DI · no store',   cfg: { di: 'none', network: 'none', db: 'none', prefs: 'none', image: 'none', sample: 'yes' }, forbidden: ITEM_TYPES },
  { name: 'no sample · no store', cfg: { di: 'hilt', network: 'none', db: 'none', prefs: 'none', image: 'none', sample: 'no' }, forbidden: [...ITEM_TYPES, /\bLoginScreen\b/, /\bHomeViewModel\b/] },
  { name: 'room · hilt',          cfg: { di: 'hilt', network: 'none', db: 'room', prefs: 'none', image: 'none', sample: 'yes' }, forbidden: [/\bItemQueries\b/, /sqldelight/] },
  { name: 'sqldelight · koin',    cfg: { di: 'koin', network: 'none', db: 'sqldelight', prefs: 'none', image: 'none', sample: 'yes' }, forbidden: [/\bItemDao\b/, /androidx\.room/] },
  { name: 'glide · sqldelight',   cfg: { di: 'none', network: 'ktor', db: 'sqldelight', prefs: 'datastore', image: 'glide', sample: 'yes' }, forbidden: [/\bcoil3\b/, /\bItemDao\b/] },
];

const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--') || t.startsWith('#');
};

let failures = 0;

for (const c of CASES) {
  const root = mkdtempSync(join(tmpdir(), 'ak-audit-'));
  try {
    const resolved = resolvedFor(c.cfg);
    scaffold({
      root, toolRoot,
      config: { ...baseConfig, ...c.cfg },
      resolved,
      versionCatalog: renderVersionCatalog(resolved),
    });

    const leaks = [];
    for (const file of walk(root)) {
      if (file.endsWith('.jar') || file.includes('gradlew')) continue;
      const body = readFileSync(file, 'utf8');
      // An unrendered conditional means a template tag survived into real output.
      if (body.includes('{{')) leaks.push(`${relative(root, file)}: unsubstituted {{ }}`);
      for (const line of body.split('\n')) {
        if (isComment(line)) continue;
        for (const rx of c.forbidden) {
          if (rx.test(line)) leaks.push(`${relative(root, file)}: ${line.trim().slice(0, 70)}`);
        }
      }
    }

    if (leaks.length) {
      failures++;
      console.log(`FAIL  ${c.name}`);
      for (const l of leaks.slice(0, 6)) console.log(`        ${l}`);
      if (leaks.length > 6) console.log(`        ...and ${leaks.length - 6} more`);
    } else {
      console.log(`ok    ${c.name}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} configuration(s) leaked identifiers` : '\nall configurations clean');
process.exit(failures ? 1 : 0);
