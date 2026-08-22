#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveAll, checkConstraints, resolveAndroidPlatform, studioOptions, studioFromBuild, compareVersions } from '../src/resolver.mjs';
import { renderVersionCatalog } from '../src/toml.mjs';
import { scaffold, detectSdkDir, detectJdk, detectStudios, openInStudio } from '../src/scaffold.mjs';
import { C } from '../src/color.mjs';
import { printLibrary, printLibraries, printStudios, summaryLine } from '../src/info.mjs';

const toolRoot = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(toolRoot, 'catalog.json'), 'utf8'));
const compat = JSON.parse(readFileSync(join(toolRoot, 'compat.json'), 'utf8'));
// Same file the GUI serves, so the two interfaces cannot describe a library differently.
const libraries = JSON.parse(readFileSync(join(toolRoot, 'libraries.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const has = (n) => argv.includes(`--${n}`) || argv.includes(n);

// Loaded from endoflife.date; see tools/fetch_api_levels.mjs
const API_LEVELS = JSON.parse(readFileSync(join(toolRoot, 'android-api-levels.json'), 'utf8')).levels;

// A package segment that is a Java keyword compiles to nothing sensible, and the error
// Gradle produces for it is deeply unhelpful.
const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null', 'in', 'is', 'object', 'val', 'var', 'fun',
]);

const CHOICES = {
  di: ['hilt', 'koin', 'none'],
  network: ['retrofit', 'ktor', 'none'],
  db: ['room', 'sqldelight', 'none'],
  prefs: ['datastore', 'none'],
  image: ['coil', 'glide', 'none'],
  sample: ['yes', 'no'],
};

// Shown when asking about the sample, so the choice is informed rather than blind.
const SAMPLE_CONTENTS = [
  'Login screen  - email/password, validation, loading and error states',
  'Home screen   - greeting, item list, add/clear, sign out',
  'AuthRepository with a stub signIn you replace with your backend',
  '5 unit tests  - fakes + ViewModel tests (JUnit, coroutines-test, Turbine)',
];


// --- Android Studio / AGP ceiling --------------------------------------------

/** The installed Studio, mapped to a compat.json row (null if none found or unrecognised). */
function detectedStudio() {
  for (const s of detectStudios()) {
    const row = studioFromBuild(s.buildNumber, compat);
    if (row) return row;
  }
  return null;
}

/**
 * No --studio flag means "use the Android Studio that is actually installed", because
 * generating a project the user's IDE refuses to open is the problem this option exists for.
 */
function resolveStudioChoice(input) {
  if (input === undefined) {
    const detected = detectedStudio();
    if (detected) {
      const opt = studioOptions(compat).find((o) => o.version === detected.version) ?? detected;
      console.log(`${C.dim}detected ${opt.label ?? opt.name} - capping AGP at ${opt.agpMax}.x (pass --studio=latest to override)${C.off}`);
      return opt;
    }
    return null;
  }
  return matchStudio(input);
}

/**
 * Resolves whatever the user typed - a list number, a name like "Narwhal", a version like
 * "2025.1.1", or a bare AGP version like "8.13" - into an AGP ceiling.
 */
function matchStudio(input, opts = {}) {
  const options = studioOptions(compat);
  if (input == null || input === '' || /^latest$/i.test(input)) return null;

  const asIndex = Number(input);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= options.length) return options[asIndex - 1];

  const needle = String(input).toLowerCase().trim();
  const byExact = options.find(
    (o) => o.version === needle || o.name.toLowerCase() === needle || o.label.toLowerCase() === needle,
  );
  if (byExact) return byExact;

  // A bare AGP version means "cap AGP here", regardless of which Studio that implies.
  if (/^\d+\.\d+/.test(needle)) {
    const mm = needle.split('.').slice(0, 2).join('.');
    if (compat.agp.some((a) => a.agpMajorMinor === mm)) {
      return { name: 'custom', version: `AGP ${mm}`, label: `AGP <= ${mm}`, agpMax: mm };
    }
  }

  const byPrefix = options.find((o) => o.name.toLowerCase().startsWith(needle));
  if (byPrefix) return byPrefix;

  // undefined = not understood. null already means "latest, no cap", so they cannot share
  // a value: the interactive prompt needs to re-ask rather than silently uncap AGP.
  if (opts.quiet) return undefined;
  console.log(`${C.yellow}! "${input}" did not match an Android Studio version - using the latest AGP${C.off}`);
  return null;
}


async function prompt() {
  // Node's readline/promises only resolves the FIRST question when stdin is a pipe, so
  // scripted answers are read up front and served from a queue instead. A real terminal
  // takes the normal interactive path.
  const piped = !process.stdin.isTTY;
  let queue = [];
  if (piped) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    queue = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  const rl = piped ? null : createInterface({ input: process.stdin, output: process.stdout });

  const ask = async (q, def) => {
    const prompt = `${q} ${C.dim}(${def})${C.off} `;
    if (piped) {
      const line = queue.shift();
      if (line === undefined) throw new Error('ran out of piped input while prompting');
      process.stdout.write(prompt + line + '\n');
      return line.trim() || def;
    }
    return (await rl.question(prompt)).trim() || def;
  };
  const reject = (msg) => console.log(`  ${C.yellow}${msg}${C.off}`);

  /**
   * Keeps asking until the answer is actually one of the options. Silently falling back to a
   * default hides typos - you think you chose Koin, get Hilt, and only find out later.
   */
  const pick = async (label, key) => {
    const opts = CHOICES[key];
    const width = Math.max(...opts.map((o) => o.length)) + 2;
    console.log(`
${C.bold}${label}${C.off}`);
    opts.forEach((o, i) => {
      console.log(`  ${C.dim}${i + 1}.${C.off} ${C.cyan}${o.padEnd(width)}${C.off}${C.dim}${summaryLine(o)}${C.off}`);
    });
    for (;;) {
      const raw = (await ask('  choose', opts[0])).toLowerCase();
      if (opts.includes(raw)) return raw;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) return opts[n - 1];
      reject(`"${raw}" is not an option - type a name, or 1-${opts.length}`);
    }
  };

  const askAppName = async () => {
    for (;;) {
      const v = await ask('App name', 'MyApp');
      if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(v)) return v.trim();
      reject('Use letters, digits, spaces, - or _, starting with a letter.');
    }
  };

  // A malformed applicationId does not fail until Gradle is well into the build.
  const askPackage = async (def) => {
    for (;;) {
      const v = (await ask('Package', def)).toLowerCase();
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(v)) {
        reject('Needs at least two lowercase segments, e.g. com.example.myapp');
        continue;
      }
      const reserved = v.split('.').find((seg) => JAVA_KEYWORDS.has(seg));
      if (reserved) {
        reject(`"${reserved}" is a Java keyword and cannot be a package segment.`);
        continue;
      }
      return v;
    }
  };

  const askMinSdk = async () => {
    console.log(`
${C.bold}minSdk${C.off} ${C.dim}- the oldest Android you support${C.off}`);
    for (const l of API_LEVELS) {
      const status = l.eol ? `${C.dim}security updates ended ${l.eol}${C.off}` : `${C.green}still supported${C.off}`;
      console.log(`  ${C.cyan}${String(l.api).padEnd(4)}${C.off}${C.dim}Android ${String(l.version).padEnd(5)}${(l.codename ?? '').padEnd(18)}${C.off}${status}`);
    }
    for (;;) {
      const raw = await ask('  API level', '24');
      const n = Number(raw);
      if (API_LEVELS.some((l) => l.api === n)) return n;
      const lo = Math.min(...API_LEVELS.map((l) => l.api));
      const hi = Math.max(...API_LEVELS.map((l) => l.api));
      reject(`"${raw}" is not an API level in ${lo}-${hi}.`);
    }
  };

  const askStudio = async () => {
    const detected = detectedStudio();
    const options = studioOptions(compat);
    console.log(`
${C.dim}Android Studio decides the highest AGP you can open.${C.off}`);
    for (const [i, s] of options.entries()) {
      const mark = detected && s.version === detected.version ? `${C.green}  <- detected${C.off}` : '';
      console.log(`  ${String(i + 1).padStart(2)}. ${s.label.padEnd(34)} AGP <= ${String(s.agpMax).padEnd(5)} Gradle ${s.gradle}${mark}`);
    }
    const def = detected ? `${detected.name} | ${detected.version}` : 'latest';
    for (;;) {
      const raw = await ask('  Android Studio (number, name, or "latest")', def);
      const match = matchStudio(raw, { quiet: true });
      if (match !== undefined) return match;
      reject(`"${raw}" did not match - type 1-${options.length}, a name like Narwhal, a version like 2025.1.1, or "latest".`);
    }
  };

  const appName = await askAppName();
  const packageName = await askPackage(`com.example.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
  const di = await pick('Dependency injection', 'di');
  const network = await pick('Networking', 'network');
  const db = await pick('Database', 'db');
  const prefs = await pick('Preferences', 'prefs');
  const image = await pick('Image loading', 'image');

  console.log(`
${C.bold}Sample code${C.off}`);
  for (const line of SAMPLE_CONTENTS) console.log(`  ${C.dim}${line}${C.off}`);
  console.log(`  ${C.dim}Choosing "no" keeps all the wiring but leaves the UI empty.${C.off}`);
  const sample = await pick('Include it?', 'sample');

  const minSdk = await askMinSdk();
  const studio = await askStudio();

  rl?.close();
  return { appName, packageName, di, network, db, prefs, image, sample, minSdk, studio };
}

function run(cmd, args, cwd, env = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(`${C.dim}${d}${C.off}`); });
    p.stderr.on('data', (d) => { out += d; process.stdout.write(`${C.dim}${d}${C.off}`); });
    p.on('close', (code) => res({ code, out }));
  });
}

// ---------------------------------------------------------------------------

if (has('list-studios')) { printStudios(); process.exit(0); }

if (has('list-libs')) { printLibraries(); process.exit(0); }

const infoFor = flag('info', null);
if (infoFor !== null) { process.exit(printLibrary(infoFor) ? 0 : 1); }

if (has('help') || has('h')) {
  console.log(`
${C.bold}android-kickstart${C.off} - scaffold an Android project on the latest stable libraries

  ${C.dim}node bin/kickstart.mjs${C.off}                          interactive
  ${C.dim}node bin/kickstart.mjs --yes --build --out=../MyApp${C.off}

${C.bold}choices${C.off}
  --name=NAME            app + Gradle root project name      ${C.dim}(MyApp)${C.off}
  --package=ID           applicationId and namespace          ${C.dim}(com.example.myapp)${C.off}
  --di=hilt|koin|none    dependency injection                 ${C.dim}(hilt)${C.off}
  --network=retrofit|ktor|none                                ${C.dim}(retrofit)${C.off}
  --db=room|sqldelight|none  relational database              ${C.dim}(room)${C.off}
  --prefs=datastore|none key-value settings                    ${C.dim}(datastore)${C.off}
  --image=coil|glide|none  image loading                     ${C.dim}(coil)${C.off}
  --sample=yes|no        Login+Home sample screens and tests   ${C.dim}(yes)${C.off}
  --no-sample            shorthand for --sample=no
  --min-sdk=N                                                 ${C.dim}(24)${C.off}
  --studio=NAME|VERSION|AGP|latest   caps AGP to what your IDE opens
                         ${C.dim}e.g. --studio=Narwhal, --studio=2025.1.1, --studio=8.13${C.off}
                         ${C.dim}defaults to the installed Android Studio${C.off}

${C.bold}behaviour${C.off}
  --yes                  skip prompts, use flags
  --interactive          force the prompts even when stdin is piped
  --build                run assembleDebug + unit tests to prove it all works
  --open                 open the finished project in Android Studio
  --offline              resolve from pinned.json instead of the network
  --force                write into a non-empty directory
  --out=DIR              destination                          ${C.dim}(./<name>)${C.off}

${C.bold}information${C.off} ${C.dim}(same data the GUI shows)${C.off}
  --list-studios         every Android Studio release and what it can open
  --list-libs            every option with a summary and links
  --info=NAME            detail on one option, e.g. --info=koin
  --dry-run              print the resolved libs.versions.toml, write nothing

${C.bold}overrides${C.off}
  --compile-sdk=N  --target-sdk=N  --java=17  --gradle=9.5.0  --sdk-dir=PATH

${C.bold}recipes${C.off}
  ${C.dim}# Just ask me questions - easiest if you are unsure${C.off}
  android-kickstart

  ${C.dim}# Default stack (Hilt + Retrofit + Room + DataStore + Coil), built and opened${C.off}
  android-kickstart --yes --build --open --name=MyApp --out=~/StudioProjects/MyApp

  ${C.dim}# Kotlin Multiplatform-friendly stack${C.off}
  android-kickstart --yes --di=koin --network=ktor --db=sqldelight --name=KmpApp

  ${C.dim}# Bare shell: all the wiring, none of the sample screens${C.off}
  android-kickstart --yes --no-sample --name=Blank

  ${C.dim}# See what versions you would get, without writing anything${C.off}
  android-kickstart --dry-run --yes

  ${C.dim}# Which Android Studio can open what${C.off}
  android-kickstart --list-studios

  ${C.dim}# What is Koin, and how does it differ from Hilt?${C.off}
  android-kickstart --info=koin
  android-kickstart --list-libs

  ${C.dim}# Network is down, or you want yesterday's known-good versions${C.off}
  android-kickstart --yes --offline --name=MyApp

${C.bold}if something goes wrong${C.off}
  ${C.dim}A build failure usually means one resolved version does not compose with another.${C.off}
  ${C.dim}Re-run with --offline to fall back to the last known-good pinned set.${C.off}

GUI with the same options: ${C.dim}android-kickstart-gui${C.off}
Point-and-click if you prefer; it shows the resolved catalog live as you choose.
`);
  process.exit(0);
}

// --interactive forces the prompts even when stdin is a pipe, which is how the answers
// can be scripted or tested. Without it, a non-TTY means "use the flags".
const interactive = !has('yes') && (has('interactive') || process.stdin.isTTY);
const answers = interactive ? await prompt() : {
  appName: flag('name', 'MyApp'),
  packageName: flag('package', 'com.example.myapp'),
  di: flag('di', 'hilt'),
  network: flag('network', 'retrofit'),
  db: flag('db', 'room'),
  prefs: flag('prefs', 'datastore'),
  image: flag('image', 'coil'),
  sample: has('no-sample') ? 'no' : flag('sample', 'yes'),
  minSdk: Number(flag('min-sdk', '24')),
  studio: resolveStudioChoice(flag('studio', flag('agp', undefined))),
};

const outDir = pathResolve(flag('out', answers.appName));
if (!has('dry-run') && existsSync(outDir) && readdirSync(outDir).length && !has('force')) {
  console.error(`${C.red}refusing to write into non-empty ${outDir}${C.off} ${C.dim}(pass --force to override)${C.off}`);
  process.exit(1);
}

console.log(`\n${C.bold}android-kickstart${C.off} ${C.dim}-> ${outDir}${C.off}`);
console.log(`${C.dim}  di=${answers.di} network=${answers.network} db=${answers.db} prefs=${answers.prefs} image=${answers.image} sample=${answers.sample}${C.off}\n`);

const keys = [...new Set([
  ...catalog.profiles.base,
  ...catalog.profiles.ui.compose,
  ...(catalog.profiles.di[answers.di] ?? []),
  ...(catalog.profiles.network[answers.network] ?? []),
  ...(catalog.profiles.db[answers.db] ?? []),
  ...(catalog.profiles.prefs[answers.prefs] ?? []),
  ...(catalog.profiles.image[answers.image] ?? []),
])];

let results, errors;
if (has('offline')) {
  const pinned = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));
  results = Object.fromEntries(keys.filter((k) => pinned.versions[k]).map((k) => [k, { key: k, version: pinned.versions[k], repo: 'pinned', tag: catalog.artifacts[k]?.tag }]));
  errors = keys.filter((k) => !pinned.versions[k]).map((k) => ({ key: k, error: 'not in pinned.json' }));
  console.log(`${C.yellow}offline${C.off} ${C.dim}pinned ${pinned.pinnedAt}${C.off}`);
} else {
  const ceilings = answers.studio ? { agp: answers.studio.agpMax } : {};
  ({ results, errors } = await resolveAll(keys, catalog, { ceilings }));
  if (errors.length) {
    console.log(`${C.yellow}! ${errors.length} artifact(s) failed to resolve, falling back to pinned versions${C.off}`);
    const pinned = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));
    for (const e of errors) {
      if (pinned.versions[e.key]) results[e.key] = { key: e.key, version: pinned.versions[e.key], repo: 'pinned', tag: catalog.artifacts[e.key]?.tag };
    }
  }
}

// Derived entries must be re-derived after any pinned fallback changed their source.
for (const [k, spec] of Object.entries(catalog.artifacts)) {
  if (spec.derivedFrom && keys.includes(k) && results[spec.derivedFrom]) {
    results[k] = { key: k, version: results[spec.derivedFrom].version, derivedFrom: spec.derivedFrom, tag: spec.tag };
  }
}

console.log(`${C.green}resolved${C.off} ${Object.keys(results).length} artifacts  ${C.dim}agp=${results.agp?.version} kotlin=${results.kotlin?.version} composeBom=${results.composeBom?.version}${C.off}\n`);

const agpMm = (results.agp?.version ?? '').split('.').slice(0, 2).join('.');
const agpRow = compat.agp.find((r) => r.agpMajorMinor === agpMm);
// compileSdk comes from Google's SDK manifest, NOT from AGP's build-tools: current
// AndroidX and OkHttp releases require a platform newer than AGP's own build-tools version.
const pinnedFile = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));
let platform = { compileSdk: pinnedFile.compileSdk ?? 37, buildTools: pinnedFile.buildTools ?? null, source: 'pinned' };
if (has('offline')) {
  console.log(`${C.dim}platform: android-${platform.compileSdk} (pinned)${C.off}`);
} else {
  try {
    platform = await resolveAndroidPlatform();
    console.log(`${C.dim}latest platform: android-${platform.compileSdk}, build-tools ${platform.buildTools}${C.off}`);
  } catch (e) {
    console.log(`${C.yellow}! could not read SDK manifest (${e.message}), using pinned compileSdk=${platform.compileSdk}${C.off}`);
  }
}

// compileSdk is the lower of "newest platform Google publishes" and "newest this AGP accepts".
let compileSdk = platform.compileSdk;
if (agpRow?.maxCompileSdk && agpRow.maxCompileSdk < compileSdk) {
  compileSdk = agpRow.maxCompileSdk;
  const certainty = agpRow.compileSdkVerified ? '' : ' (inferred, not from release notes)';
  console.log(`${C.yellow}! AGP ${results.agp?.version} caps compileSdk at ${compileSdk}${certainty}; newest platform is ${platform.compileSdk}${C.off}`);
  console.log(`${C.dim}  Current AndroidX releases may require a higher compileSdk. If the build fails asking for one, you need a newer Android Studio.${C.off}`);
}

const config = {
  ...answers,
  compileSdk: Number(flag('compile-sdk', compileSdk)),
  targetSdk: Number(flag('target-sdk', compileSdk)),
  javaVersion: flag('java', String(agpRow?.minJdk ?? 17)),
  gradleVersion: flag('gradle', agpRow?.minGradle ?? '9.5.0'),
  sdkDir: flag('sdk-dir', detectSdkDir()),
};

const versionCatalog = renderVersionCatalog(results);

if (has('dry-run')) {
  console.log(`${C.dim}--- gradle/libs.versions.toml (nothing written) ---${C.off}`);
  console.log(versionCatalog);
  console.log(`${C.dim}compileSdk=${config.compileSdk} java=${config.javaVersion} gradle=${config.gradleVersion}${C.off}`);
  for (const w of checkConstraints(results, compat)) {
    if (w.level === 'warn') console.log(`${C.yellow}! ${w.msg}${C.off}`);
  }
  process.exit(0);
}

const { written } = scaffold({ root: outDir, toolRoot, config, resolved: results, versionCatalog });

console.log(`${C.green}wrote${C.off} ${written.length} files  ${C.dim}compileSdk=${config.compileSdk} java=${config.javaVersion} gradle=${config.gradleVersion}${C.off}`);
for (const w of written.filter((f) => f.endsWith('.kt'))) console.log(`  ${C.dim}${w}${C.off}`);

for (const w of checkConstraints(results, compat)) {
  if (w.level === 'warn') console.log(`${C.yellow}! ${w.msg}${C.off}`);
}
if (!config.sdkDir) console.log(`${C.yellow}! no Android SDK found - set sdk.dir in local.properties before building${C.off}`);

if (has('build')) {
  console.log(`\n${C.bold}validating${C.off} ${C.dim}gradlew :app:assembleDebug :app:testDebugUnitTest${C.off}\n`);
  const gw = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const jdk = detectJdk(Number(config.javaVersion));
  if (jdk) console.log(`${C.dim}JDK: ${jdk.home} (${jdk.source})${C.off}
`);
  else console.log(`${C.yellow}! no JDK >= ${config.javaVersion} found; the build will use whatever JAVA_HOME points at${C.off}
`);
  const { code } = await run(gw, [':app:assembleDebug', ':app:testDebugUnitTest', '--console=plain'], outDir, jdk ? { JAVA_HOME: jdk.home } : {});
  if (code === 0) {
    console.log(`\n${C.green}BUILD OK${C.off} - the version set composes and the generated unit tests pass.`);
  } else {
    console.log(`\n${C.red}BUILD FAILED (exit ${code})${C.off} - re-run with --offline to use the last known-good pinned set.`);
    process.exit(code);
  }
} else {
  console.log(`\n${C.dim}next: cd ${basename(outDir)} && gradlew :app:assembleDebug :app:testDebugUnitTest${C.off}`);
}
