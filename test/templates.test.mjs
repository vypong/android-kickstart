import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { render } from '../src/render.mjs';
import { scaffold, buildContext } from '../src/scaffold.mjs';
import { renderVersionCatalog } from '../src/toml.mjs';

const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));

// Use the pinned set so these tests never touch the network.
const resolved = Object.fromEntries(
  Object.entries(pinned.versions).map(([k, v]) => [k, { key: k, version: v }])
);

const DI = ['hilt', 'koin', 'none'];
const NET = ['retrofit', 'ktor', 'none'];
const DB = ['room', 'datastore', 'none'];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('render engine handles nesting, else, and unless', () => {
  const t = ['{{#if a}}', 'A', '{{#unless b}}', 'NB', '{{/unless}}', '{{else}}', 'E', '{{/if}}'].join('\n');
  assert.equal(render(t, { a: true, b: false }), 'A\nNB');
  assert.equal(render(t, { a: true, b: true }), 'A');
  assert.equal(render(t, { a: false, b: false }), 'E');
});

test('unbalanced blocks are rejected rather than silently mis-rendered', () => {
  assert.throws(() => render('{{#if a}}\nx', { a: true }), /unbalanced/);
});

test('every combination scaffolds with no unsubstituted placeholders', () => {
  for (const di of DI) {
    for (const network of NET) {
      for (const db of DB) {
        const dir = mkdtempSync(join(tmpdir(), 'ak-t-'));
        try {
          const config = {
            appName: 'Demo', packageName: 'com.demo.app', di, network, db,
            minSdk: 24, compileSdk: 37, targetSdk: 37, javaVersion: '17',
            gradleVersion: '9.5.0', sdkDir: null,
          };
          const { written } = scaffold({
            root: dir, toolRoot, config, resolved,
            versionCatalog: renderVersionCatalog(resolved),
          });
          assert.ok(written.length > 15, `${di}/${network}/${db} wrote too little`);

          for (const file of walk(dir)) {
            if (file.endsWith('.jar')) continue;
            const body = readFileSync(file, 'utf8');
            assert.ok(!body.includes('{{'), `unsubstituted placeholder in ${file} for ${di}/${network}/${db}`);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }
});

test('hostile app names and packages are refused, not substituted', () => {
  const base = { appName: 'Demo', packageName: 'com.demo.app', di: 'none', network: 'none', db: 'none' };

  // Each of these closes the string it lands in and appends Kotlin that Gradle would run.
  const hostilePackages = [
    'com.evil"\n        println("pwned")\n        val x = "',
    'com.evil"; System.exit(1); //',
    'com.evil`whoami`',
    '../../../etc/passwd',
    'com.evil\n',
    '',
  ];
  for (const packageName of hostilePackages) {
    assert.throws(() => buildContext({ ...base, packageName }, resolved), /invalid package/,
      `accepted hostile package ${JSON.stringify(packageName)}`);
  }

  for (const appName of ['Demo"/><x', 'Demo\n', '../Demo', '', '9Lives']) {
    assert.throws(() => buildContext({ ...base, appName }, resolved), /invalid app name/,
      `accepted hostile app name ${JSON.stringify(appName)}`);
  }

  // Ordinary values still pass.
  for (const appName of ['MyApp', 'My App', 'my-app_2']) {
    assert.doesNotThrow(() => buildContext({ ...base, appName }, resolved));
  }
  for (const packageName of ['com.example.app', 'com.example.my_app2', 'a.b']) {
    assert.doesNotThrow(() => buildContext({ ...base, packageName }, resolved));
  }
});

test('INTERNET permission follows the network choice', () => {
  for (const network of NET) {
    const dir = mkdtempSync(join(tmpdir(), 'ak-m-'));
    try {
      scaffold({
        root: dir, toolRoot, resolved,
        config: {
          appName: 'Demo', packageName: 'com.demo.app', di: 'none', network, db: 'none',
          minSdk: 24, compileSdk: 37, targetSdk: 37, javaVersion: '17',
          gradleVersion: '9.5.0', sdkDir: null,
        },
        versionCatalog: renderVersionCatalog(resolved),
      });
      const manifest = readFileSync(join(dir, 'app/src/main/AndroidManifest.xml'), 'utf8');
      const declared = manifest.includes('android.permission.INTERNET');
      // An app that cannot make requests must not ask for the permission.
      assert.equal(declared, network !== 'none', `--network=${network} got INTERNET=${declared}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('DI choice controls exactly one wiring file', () => {
  for (const di of DI) {
    const ctx = buildContext({ appName: 'D', packageName: 'c.d', di, network: 'none', db: 'none' }, resolved);
    const flags = [ctx.hilt, ctx.koin, ctx.noDi].filter(Boolean);
    assert.equal(flags.length, 1, `${di} should set exactly one DI flag`);
  }
});

test('AGP 9 suppresses the Kotlin Android plugin, AGP 8 keeps it', () => {
  const base = { appName: 'D', packageName: 'c.d', di: 'none', network: 'none', db: 'none' };
  assert.equal(buildContext(base, { agp: { version: '9.3.1' } }).agpBuiltInKotlin, true);
  assert.equal(buildContext(base, { agp: { version: '8.7.3' } }).agpBuiltInKotlin, false);

  const tpl = readFileSync(join(toolRoot, 'templates', 'app', 'build.gradle.kts.tmpl'), 'utf8');
  const agp9 = render(tpl, buildContext(base, { agp: { version: '9.3.1' } }));
  const agp8 = render(tpl, buildContext(base, { agp: { version: '8.7.3' } }));
  assert.ok(!agp9.includes('libs.plugins.kotlin.android'), 'AGP 9 must not apply kotlin.android');
  assert.ok(agp8.includes('libs.plugins.kotlin.android'), 'AGP 8 must apply kotlin.android');
});

test('version catalog references the Kotlin version for the serialization plugin', () => {
  const toml = renderVersionCatalog(resolved);
  const line = toml.split('\n').find((l) => l.includes('kotlin.plugin.serialization'));
  assert.ok(line, 'serialization plugin missing from catalog');
  assert.match(line, /version\.ref = "kotlin"/, 'serialization plugin must track the Kotlin version');
});
