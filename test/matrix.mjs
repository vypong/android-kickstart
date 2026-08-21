#!/usr/bin/env node
// Generates every (di x network x db) combination and runs a real Gradle build on each.
// This is the only thing that actually proves a resolved version set composes.
// Usage: node test/matrix.mjs [--out=DIR] [--quick]

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const outRoot = resolve(flag('out', join(tmpdir(), 'ak-matrix')));

const DI = ['hilt', 'koin', 'none'];
const NET = ['retrofit', 'ktor', 'none'];
const DB = ['room', 'none'];
const PREFS = ['datastore', 'none'];

const all = argv.includes('--quick')
  ? [['hilt', 'retrofit', 'room', 'datastore'],
     ['koin', 'ktor', 'none', 'datastore'],
     ['none', 'none', 'room', 'none']]
  : DI.flatMap((di) => NET.flatMap((n) => DB.flatMap((db) => PREFS.map((pf) => [di, n, db, pf]))));

// --start/--limit slice the run so a long matrix can be executed in chunks that each
// finish inside a background-task window.
const start = Number(flag('start', '0'));
const limit = Number(flag('limit', String(all.length)));
const combos = all.slice(start, start + limit);

function run(cmd, args, cwd) {
  return new Promise((res) => {
    // No shell: the tool path contains spaces and shell:true would not quote it.
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out }));
  });
}

mkdirSync(outRoot, { recursive: true });
const results = [];
const t0 = Date.now();

for (const [di, network, db, prefs] of combos) {
  const name = `${di}-${network}-${db}-${prefs}`;
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`${name.padEnd(24)} `);

  const gen = await run('node', [
    join(toolRoot, 'bin', 'kickstart.mjs'), '--yes', '--build', '--force',
    `--name=Demo`, `--package=com.demo.${di}${network}${db}${prefs}`.replace(/none/g, 'x'),
    `--di=${di}`, `--network=${network}`, `--db=${db}`, `--prefs=${prefs}`,
    `--studio=${flag('studio', 'latest')}`, `--out=${dir}`,
  ], toolRoot);

  // Reclaim the daemon between combinations. Each one holds ~2 GB, and several Gradle
  // versions can end up resident at once, which OOMs a 16 GB machine mid-matrix.
  if (argv.includes('--stop-daemons')) {
    const gw = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    await run(gw, ['--stop'], dir).catch(() => {});
  }

  const ok = gen.code === 0;
  // The child colours its output, so strip ANSI before line-matching or `^e:` never hits.
  const plain = gen.out.replace(/\x1b\[[0-9;]*m/g, '');
  // Surface the first Kotlin/Gradle error line, which is what you actually need.
  const firstError = (plain.match(/^e: .*$/m) ?? plain.match(/^\s*> .*$/m) ?? [''])[0].trim()
    .replace(/file:\/\/\S*?\/([^/]+\.kt)/, '$1').slice(0, 150);
  results.push({ name, ok, firstError });
  console.log(ok ? 'BUILD OK' : `FAILED  ${firstError}`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} combinations built in ${Math.round((Date.now() - t0) / 1000)}s`);
if (passed < results.length) {
  console.log('\nfailures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.name}: ${r.firstError}`);
  process.exit(1);
}
