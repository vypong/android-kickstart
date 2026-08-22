#!/usr/bin/env node
// Generates real projects and builds each one, failing on Kotlin WARNINGS as well as errors -
// a deprecation warning today is a compile error two releases from now.
//
// The full cartesian product is 3*3*3*2*3*2 = 324 builds, which nobody will ever run. The
// default is an all-pairs (pairwise) set: every pair of option values appears together in at
// least one project, which is where interaction bugs actually live. --full does the lot.
//
//   node test/matrix.mjs                     pairwise (default)
//   node test/matrix.mjs --full              every combination
//   node test/matrix.mjs --start=0 --limit=6 slice it to fit a time window
//   node test/matrix.mjs --stop-daemons      reclaim ~2GB between builds

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const outRoot = resolve(flag('out', join(tmpdir(), 'ak-matrix')));

const DIMS = {
  di:      ['hilt', 'koin', 'none'],
  network: ['retrofit', 'ktor', 'none'],
  db:      ['room', 'sqldelight', 'none'],
  prefs:   ['datastore', 'none'],
  image:   ['coil', 'glide', 'none'],
  sample:  ['yes', 'no'],
};
const NAMES = Object.keys(DIMS);

function cartesian() {
  return NAMES.reduce(
    (acc, key) => acc.flatMap((row) => DIMS[key].map((v) => ({ ...row, [key]: v }))),
    [{}]
  );
}

const pairsOf = (row) => {
  const out = [];
  for (let i = 0; i < NAMES.length; i++) {
    for (let j = i + 1; j < NAMES.length; j++) {
      out.push(`${NAMES[i]}=${row[NAMES[i]]}|${NAMES[j]}=${row[NAMES[j]]}`);
    }
  }
  return out;
};

/**
 * Greedy all-pairs: repeatedly take the candidate that covers the most still-uncovered value
 * pairs. The search space is small enough to brute force over the full product each round,
 * which yields a tighter set than a randomised heuristic.
 */
function pairwise() {
  const required = new Set();
  for (let i = 0; i < NAMES.length; i++) {
    for (let j = i + 1; j < NAMES.length; j++) {
      for (const a of DIMS[NAMES[i]]) {
        for (const b of DIMS[NAMES[j]]) required.add(`${NAMES[i]}=${a}|${NAMES[j]}=${b}`);
      }
    }
  }

  const all = cartesian();
  const covered = new Set();
  const chosen = [];

  while (covered.size < required.size) {
    let best = null;
    let bestGain = 0;
    for (const row of all) {
      const gain = pairsOf(row).filter((p) => !covered.has(p)).length;
      if (gain > bestGain) { bestGain = gain; best = row; }
    }
    if (!best) break;
    for (const p of pairsOf(best)) covered.add(p);
    chosen.push(best);
  }
  return chosen;
}

const all = argv.includes('--full') ? cartesian() : pairwise();
const start = Number(flag('start', '0'));
const limit = Number(flag('limit', String(all.length)));
const combos = all.slice(start, start + limit);

function run(cmd, args, cwd) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out }));
  });
}

const short = (line) => String(line).replace(/file:\/\/\S*?\/([^/]+\.kt)/, '$1').slice(0, 100);

mkdirSync(outRoot, { recursive: true });
console.log(`${all.length} combination(s) ${argv.includes('--full') ? '(full)' : '(pairwise)'}; `
  + `running ${combos.length} from index ${start}\n`);

const results = [];
const t0 = Date.now();

for (const combo of combos) {
  const name = NAMES.map((k) => combo[k]).join('-');
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`${name.padEnd(44)} `);

  const args = [
    join(toolRoot, 'bin', 'kickstart.mjs'), '--yes', '--build', '--force',
    '--name=Demo', `--package=com.demo.${name.replace(/-/g, '').replace(/none/g, 'x')}`,
    ...NAMES.map((k) => `--${k}=${combo[k]}`),
    `--studio=${flag('studio', 'latest')}`, `--out=${dir}`,
  ];

  // Gradle occasionally fails for reasons that have nothing to do with the generated code -
  // daemon eviction under memory pressure, or a catalog-accessor cache race when projects are
  // created back to back. Retry once so a flake is reported as flaky, not as broken.
  let gen = await run('node', args, toolRoot);
  let flaky = false;
  if (gen.code !== 0) {
    const retry = await run('node', args, toolRoot);
    if (retry.code === 0) { flaky = true; gen = retry; }
    else gen = retry;
  }

  if (argv.includes('--stop-daemons')) {
    const gw = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    await run(gw, ['--stop'], dir).catch(() => {});
  }

  const plain = gen.out.replace(/\x1b\[[0-9;]*m/g, '');
  const errors = [...plain.matchAll(/^e: .*$/gm)].map((m) => m[0]);
  // Only warnings pointing at generated sources. Dependency warnings are not ours to fix.
  const warnings = [...plain.matchAll(/^w: file:.*$/gm)].map((m) => m[0]);
  const built = gen.code === 0;

  results.push({ name, built, warnings, errors, flaky });

  if (built && !warnings.length) console.log(flaky ? 'OK (needed a retry)' : 'OK');
  else if (!built) console.log(`FAILED    ${short(errors[0] ?? plain.match(/^\s*> .*$/m)?.[0] ?? '')}`);
  else console.log(`WARN x${warnings.length}  ${short(warnings[0])}`);
}

const clean = results.filter((r) => r.built && !r.warnings.length);
const flakes = results.filter((r) => r.flaky);
console.log(`\n${clean.length}/${results.length} clean in ${Math.round((Date.now() - t0) / 1000)}s`
  + (flakes.length ? `  (${flakes.length} needed a retry: ${flakes.map((f) => f.name).join(', ')})` : ''));

const bad = results.filter((r) => !r.built || r.warnings.length);
if (bad.length) {
  console.log('\nneeds attention:');
  for (const r of bad) {
    console.log(`  ${r.name}  ${r.built ? `${r.warnings.length} warning(s)` : 'BUILD FAILED'}`);
    for (const line of [...r.errors, ...r.warnings].slice(0, 3)) console.log(`      ${short(line)}`);
  }
  process.exit(1);
}
