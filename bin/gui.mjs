#!/usr/bin/env node
// Local GUI for android-kickstart. Serves a single page on 127.0.0.1 and opens the browser.
// The browser cannot read real filesystem paths, so folder picking is delegated to the
// platform's native dialog through a child process.

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolveAll, checkConstraints, resolveAndroidPlatform, studioOptions, studioFromBuild } from '../src/resolver.mjs';
import { renderVersionCatalog } from '../src/toml.mjs';
import { scaffold, detectSdkDir, detectJdk, detectStudios, openInStudio } from '../src/scaffold.mjs';

const toolRoot = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(toolRoot, 'catalog.json'), 'utf8'));
const compat = JSON.parse(readFileSync(join(toolRoot, 'compat.json'), 'utf8'));
const apiLevels = JSON.parse(readFileSync(join(toolRoot, 'android-api-levels.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const PORT = Number(flag('port', '0'));
const NO_OPEN = argv.includes('--no-open');
const KEEP_ALIVE = argv.includes('--keep-alive');

// The GUI is an app, not a daemon: the page heartbeats, and the server exits once nobody is
// looking at it. Without this you are left with a stray node process after closing the tab.
const IDLE_TIMEOUT_MS = 20_000;
let lastSeen = Date.now();
let activeJobs = 0;

if (!KEEP_ALIVE) {
  const timer = setInterval(() => {
    if (activeJobs > 0) { lastSeen = Date.now(); return; }
    if (Date.now() - lastSeen > IDLE_TIMEOUT_MS) {
      console.log('browser closed - shutting down');
      process.exit(0);
    }
  }, 5000);
  timer.unref();
}

function detectedStudioRow() {
  for (const s of detectStudios()) {
    const row = studioFromBuild(s.buildNumber, compat);
    if (row) return row;
  }
  return null;
}

/** Preferred default project home: an existing StudioProjects folder, else the home dir. */
function defaultOut() {
  for (const name of ['StudioProjects', 'AndroidStudioProjects', 'Projects']) {
    const candidate = join(homedir(), name);
    if (existsSync(candidate)) return candidate;
  }
  return homedir();
}

function keysFor(c) {
  return [...new Set([
    ...catalog.profiles.base,
    ...catalog.profiles.ui.compose,
    ...(catalog.profiles.di[c.di] ?? []),
    ...(catalog.profiles.network[c.network] ?? []),
    ...(catalog.profiles.db[c.db] ?? []),
    ...(catalog.profiles.prefs[c.prefs] ?? []),
    ...(catalog.profiles.image[c.image] ?? []),
  ])];
}

function studioRow(version) {
  return version ? studioOptions(compat).find((s) => s.version === version) ?? null : null;
}

/** Shared pipeline: resolve versions, then work out the SDK/Gradle/JDK triple that follows. */
async function resolvePlan(c) {
  const studio = studioRow(c.studio);
  const ceilings = studio ? { agp: studio.agpMax } : {};
  const { results, errors } = await resolveAll(keysFor(c), catalog, { ceilings });

  if (errors.length) {
    const pinned = JSON.parse(readFileSync(join(toolRoot, 'pinned.json'), 'utf8'));
    for (const e of errors) {
      if (pinned.versions[e.key]) results[e.key] = { key: e.key, version: pinned.versions[e.key], repo: 'pinned' };
    }
  }
  for (const [k, spec] of Object.entries(catalog.artifacts)) {
    if (spec.derivedFrom && results[spec.derivedFrom] && keysFor(c).includes(k)) {
      results[k] = { key: k, version: results[spec.derivedFrom].version, derivedFrom: spec.derivedFrom };
    }
  }

  const agpMm = (results.agp?.version ?? '').split('.').slice(0, 2).join('.');
  const agpRow = compat.agp.find((r) => r.agpMajorMinor === agpMm);

  let platform = { compileSdk: 37 };
  try { platform = await resolveAndroidPlatform(); } catch { /* fall back to pinned default */ }

  let compileSdk = platform.compileSdk;
  const warnings = checkConstraints(results, compat).filter((w) => w.level === 'warn').map((w) => w.msg);
  if (agpRow?.maxCompileSdk && agpRow.maxCompileSdk < compileSdk) {
    compileSdk = agpRow.maxCompileSdk;
    warnings.unshift(`AGP ${results.agp?.version} caps compileSdk at ${compileSdk} (newest platform is ${platform.compileSdk}).`);
  }

  return {
    results,
    warnings,
    config: {
      appName: c.name,
      packageName: c.packageName,
      di: c.di, network: c.network, db: c.db, prefs: c.prefs,
      image: c.image ?? 'coil', sample: c.sample ?? 'yes',
      minSdk: c.minSdk,
      compileSdk,
      targetSdk: compileSdk,
      javaVersion: String(agpRow?.minJdk ?? 17),
      gradleVersion: agpRow?.minGradle ?? '9.5.0',
      sdkDir: detectSdkDir(),
    },
  };
}

/** Native folder chooser. Browsers only ever hand back a name, never a usable path. */
function pickFolder() {
  return new Promise((resolve) => {
    let cmd, args;
    if (process.platform === 'win32') {
      // -STA is required: FolderBrowserDialog is a single-threaded-apartment COM control.
      cmd = 'powershell';
      args = ['-NoProfile', '-STA', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms;' +
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
        '$d.Description = "Choose where to create the project";' +
        '$d.ShowNewFolderButton = $true;' +
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }'];
    } else if (process.platform === 'darwin') {
      cmd = 'osascript';
      args = ['-e', 'POSIX path of (choose folder with prompt "Choose where to create the project")'];
    } else {
      cmd = 'zenity';
      args = ['--file-selection', '--directory', '--title=Choose where to create the project'];
    }

    const p = spawn(cmd, args, { windowsHide: false });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ error: e.message }));
    p.on('close', () => {
      const path = out.trim().split('\n').pop()?.trim();
      resolve(path ? { path } : { error: err.trim() || null });
    });
  });
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  return {
    out: (text) => res.write(`event: out\ndata: ${JSON.stringify(text)}\n\n`),
    done: (ok, message) => { res.write(`event: done\ndata: ${JSON.stringify({ ok, message })}\n\n`); res.end(); },
  };
}

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  try {
    if (url.pathname === '/') {
      const html = readFileSync(join(toolRoot, 'gui', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Static assets: vendored logos and the library metadata. Path is sanitised to a bare
    // filename so a crafted request cannot escape the gui directory.
    if (url.pathname.startsWith('/logos/') || url.pathname.startsWith('/fonts/')
        || url.pathname === '/libraries.json') {
      const dir = url.pathname.startsWith('/logos/') ? 'logos'
        : url.pathname.startsWith('/fonts/') ? 'fonts' : null;
      const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) { res.writeHead(400); return res.end(); }
      const file = dir ? join(toolRoot, 'gui', dir, name) : join(toolRoot, 'libraries.json');
      if (!existsSync(file)) { res.writeHead(404); return res.end(); }
      const type = name.endsWith('.svg') ? 'image/svg+xml'
        : name.endsWith('.png') ? 'image/png'
        : name.endsWith('.woff2') ? 'font/woff2'
        : name.endsWith('.css') ? 'text/css'
        : 'application/json';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(file));
    }

    if (url.pathname === '/api/ping') {
      lastSeen = Date.now();
      return json(200, { ok: true });
    }

    if (url.pathname === '/api/bye') {
      // sendBeacon on tab close. Never quit out from under a running build.
      lastSeen = 0;
      res.writeHead(204); res.end();
      if (!KEEP_ALIVE && activeJobs === 0) setTimeout(() => process.exit(0), 250);
      return undefined;
    }

    if (url.pathname === '/api/init') {
      return json(200, {
        studios: studioOptions(compat),
        detected: detectedStudioRow(),
        detectedBuild: detectStudios()[0]?.buildNumber ?? null,
        defaultOut: defaultOut(),
        sdkDir: detectSdkDir(),
        jdk: detectJdk(17),
        apiLevels: apiLevels.levels,
        apiLevelsLink: apiLevels._link,
      });
    }

    if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
      return json(200, await pickFolder());
    }

    if (url.pathname === '/api/preview' && req.method === 'POST') {
      const c = await readBody(req);
      const plan = await resolvePlan(c);
      return json(200, {
        toml: renderVersionCatalog(plan.results),
        versions: Object.fromEntries(Object.entries(plan.results).map(([k, v]) => [k, v.version])),
        compileSdk: plan.config.compileSdk,
        gradleVersion: plan.config.gradleVersion,
        javaVersion: plan.config.javaVersion,
        warnings: plan.warnings,
      });
    }

    if (url.pathname === '/api/create') {
      const q = Object.fromEntries(url.searchParams);
      const stream = sse(res);
      activeJobs++;
      res.on('close', () => { activeJobs = Math.max(0, activeJobs - 1); lastSeen = Date.now(); });
      const c = { ...q, minSdk: Number(q.minSdk) || 24 };

      stream.out(`resolving versions…\n`);
      const plan = await resolvePlan(c);
      stream.out(`agp ${plan.results.agp?.version}  kotlin ${plan.results.kotlin?.version}  composeBom ${plan.results.composeBom?.version}\n`);
      for (const w of plan.warnings) stream.out(`! ${w}\n`);

      const outDir = pathResolve(join(c.out, c.name));
      if (existsSync(outDir) && readdirSync(outDir).length) {
        return stream.done(false, `${outDir} already exists and is not empty.`);
      }

      const { written } = scaffold({
        root: outDir, toolRoot, config: plan.config, resolved: plan.results,
        versionCatalog: renderVersionCatalog(plan.results),
      });
      stream.out(`\nwrote ${written.length} files to ${outDir}\n`);

      if (!q.build) {
        if (q.open) {
          const r = openInStudio(outDir, spawn);
          return stream.done(true, r.opened
            ? 'Project ready and opening in Android Studio.'
            : `Project ready at ${outDir} (could not open the IDE: ${r.reason}).`);
        }
        return stream.done(true, `Project ready. Open ${outDir} in Android Studio.`);
      }

      const jdk = detectJdk(Number(plan.config.javaVersion));
      stream.out(`\nbuilding with ${jdk ? jdk.home : 'default JAVA_HOME'}\n\n`);
      const gw = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
      const child = spawn(gw, [':app:assembleDebug', ':app:testDebugUnitTest', '--console=plain'], {
        cwd: outDir,
        env: { ...process.env, ...(jdk ? { JAVA_HOME: jdk.home } : {}) },
        shell: process.platform === 'win32',
      });
      child.stdout.on('data', (d) => stream.out(String(d)));
      child.stderr.on('data', (d) => stream.out(String(d)));
      child.on('close', (code) => {
        if (code !== 0) return stream.done(false, `Gradle exited ${code}, see the log above.`);
        if (!q.open) return stream.done(true, 'Build and unit tests passed.');

        const opened = openInStudio(outDir, spawn);
        stream.out(opened.opened
          ? '\nopening in Android Studio…\n'
          : `\ncould not open the IDE: ${opened.reason}\n`);
        return stream.done(true, opened.opened
          ? 'Build and tests passed. Opening in Android Studio.'
          : `Build and tests passed. Open ${outDir} manually (${opened.reason}).`);
      });
      return undefined;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    if (!res.headersSent) json(500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  console.log(`android-kickstart GUI  ${url}`);
  console.log(KEEP_ALIVE
    ? 'press Ctrl+C to stop'
    : 'closes automatically when you close the tab (--keep-alive to stay up)');
  if (NO_OPEN) return;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
});
