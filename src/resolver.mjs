// Resolves latest *stable* versions for Android libraries from Maven metadata.
// Zero dependencies. Pure functions where possible so the version logic is unit-testable.

export const REPOS = {
  google: 'https://dl.google.com/dl/android/maven2',
  central: 'https://repo1.maven.org/maven2',
};

// A version is stable only if it is digits and dots, nothing else.
// This deliberately rejects -alpha, -beta, -rc, -RC, -eap, -dev, -M1, -SNAPSHOT in one rule,
// and happily accepts CalVer like 2026.08.00.
const STABLE = /^[0-9]+(\.[0-9]+)*$/;

export function isStable(version, pattern) {
  return pattern ? new RegExp(pattern).test(version) : STABLE.test(version);
}

// Segment-wise numeric compare. Lexicographic would rank 2.8.4 above 2.8.10.
export function compareVersions(a, b) {
  const pa = a.split(/[.\-+]/), pb = b.split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? '0', 10), nb = parseInt(pb[i] ?? '0', 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const c = String(pa[i] ?? '').localeCompare(String(pb[i] ?? ''));
      if (c !== 0) return c;
      continue;
    }
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function metadataUrl(repo, group, artifact) {
  const base = REPOS[repo];
  if (!base) throw new Error(`unknown repo "${repo}"`);
  return `${base}/${group.replace(/\./g, '/')}/${artifact}/maven-metadata.xml`;
}

export function parseVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1].trim());
}

async function getText(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'android-kickstart' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Fetch every published version, then pick. We never trust <release> or <latest>:
// Kotlin's <release> currently points at an -RC.
export async function resolveArtifact(key, spec, opts = {}) {
  const url = metadataUrl(spec.repo, spec.group, spec.artifact);
  const all = parseVersions(await getText(url, opts.timeoutMs));
  if (!all.length) throw new Error(`no <version> entries at ${url}`);

  const stable = all.filter((v) => isStable(v, spec.stablePattern));
  let pool = opts.includePrerelease ? all : stable;
  if (!pool.length) throw new Error(`no stable version among ${all.length} (newest raw: ${all[all.length - 1]})`);

  // A ceiling pins the artifact to a major.minor series, e.g. AGP "9.2" accepts 9.2.x but
  // not 9.3.0. Used to keep AGP within what the user's Android Studio can open.
  const ceiling = opts.ceilings?.[key];
  if (ceiling) {
    const capped = pool.filter((v) => compareVersions(v, `${ceiling}.999999`) <= 0);
    if (!capped.length) throw new Error(`no stable version at or below ${ceiling}.x (oldest available: ${pool[0]})`);
    pool = capped;
  }

  const sorted = [...pool].sort(compareVersions);
  const version = sorted[sorted.length - 1];
  const newestAny = [...all].sort(compareVersions).pop();

  return {
    key,
    version,
    coordinates: `${spec.group}:${spec.artifact}`,
    repo: spec.repo,
    totalPublished: all.length,
    // The trap made visible: what a naive "take the last entry" would have picked.
    naiveLastEntry: all[all.length - 1],
    newestAny,
    skippedPrerelease: newestAny !== version,
    tag: spec.tag,
    note: spec.note,
  };
}

// Plugin IDs resolve through a marker artifact: <id>:<id>.gradle.plugin
// Check EVERY repo, never stop at the first that answers: Google Maven mirrors a stale
// com.google.devtools.ksp marker frozen at 1.5.30-1.0.0 (2021) while Central has the real one.
export async function verifyPluginMarker(pluginId, version, repos = ['central', 'google']) {
  const attempts = [];
  for (const repo of repos) {
    try {
      const xml = await getText(metadataUrl(repo, pluginId, `${pluginId}.gradle.plugin`));
      const versions = parseVersions(xml);
      attempts.push({ repo, present: versions.includes(version), newest: versions[versions.length - 1] });
    } catch (e) {
      attempts.push({ repo, present: false, error: e.message });
    }
  }
  const hit = attempts.find((a) => a.present);
  const stale = attempts.filter((a) => !a.present && a.newest && compareVersions(a.newest, version) < 0);
  return {
    pluginId, version,
    present: Boolean(hit),
    repo: hit?.repo ?? null,
    attempts,
    staleMirrors: stale.map((a) => `${a.repo} is stale at ${a.newest}`),
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

export async function resolveAll(keys, catalog, opts = {}) {
  const artifacts = catalog.artifacts;
  const fetched = keys.filter((k) => artifacts[k] && !artifacts[k].derivedFrom);
  const derived = keys.filter((k) => artifacts[k]?.derivedFrom);

  const results = {};
  const errors = [];

  const settled = await mapLimit(fetched, opts.concurrency ?? 8, async (key) => {
    try {
      return await resolveArtifact(key, artifacts[key], opts);
    } catch (e) {
      return { key, error: e.message, coordinates: `${artifacts[key].group}:${artifacts[key].artifact}`, repo: artifacts[key].repo };
    }
  });

  for (const r of settled) {
    if (r.error) errors.push(r);
    else results[r.key] = r;
  }

  for (const key of derived) {
    const spec = artifacts[key];
    const src = results[spec.derivedFrom];
    if (!src) { errors.push({ key, error: `cannot derive from unresolved "${spec.derivedFrom}"` }); continue; }
    results[key] = {
      key, version: src.version, derivedFrom: spec.derivedFrom,
      coordinates: `(derived from ${spec.derivedFrom})`, tag: spec.tag, note: spec.note,
    };
  }

  return { results, errors };
}

// --- constraint checks (the part no HTTP endpoint can answer) -----------------

export function checkConstraints(results, compat) {
  const warnings = [];

  const agp = results.agp?.version;
  if (agp) {
    const mm = agp.split('.').slice(0, 2).join('.');
    const row = compat.agp.find((r) => r.agpMajorMinor === mm);
    if (row) {
      warnings.push({ level: 'info', msg: `AGP ${agp} requires Gradle >= ${row.minGradle}, JDK >= ${row.minJdk}, buildTools ${row.buildTools}` });
    } else {
      warnings.push({ level: 'warn', msg: `AGP ${agp} is not in compat.json (last verified ${compat._lastVerified}). Gradle/JDK floor unknown - the generated build MUST be validated by running gradlew.` });
    }
  }

  const kotlin = results.kotlin?.version;
  const ksp = results.ksp?.version;
  if (kotlin && ksp) {
    // KSP1 used a "<kotlin>-<ksp>" compound version. KSP2 versions independently.
    if (ksp.startsWith(`${kotlin}-`)) {
      warnings.push({ level: 'info', msg: `KSP ${ksp} is pinned to Kotlin ${kotlin} - consistent.` });
    } else if (/^\d+\.\d+\.\d+$/.test(ksp)) {
      warnings.push({ level: 'warn', msg: `KSP ${ksp} uses independent versioning (KSP2) - it is NOT pinned to Kotlin ${kotlin}. Pairing can only be proven by a real build.` });
    }
  }

  if (results.kotlinxSerialization && kotlin) {
    warnings.push({ level: 'warn', msg: `kotlinx-serialization LIBRARY is ${results.kotlinxSerialization.version}, but the serialization PLUGIN version tracks Kotlin (${kotlin}). Do not reuse one version ref for both.` });
  }

  return warnings;
}

// --- Android SDK platform ----------------------------------------------------
// compileSdk cannot be derived from AGP: current AndroidX/OkHttp releases demand a
// compileSdk newer than the AGP release's own build-tools. Google's SDK repository
// manifest is the machine-readable source of truth for what platforms exist.
const SDK_MANIFEST = 'https://dl.google.com/android/repository/repository2-3.xml';

export async function resolveAndroidPlatform(opts = {}) {
  const xml = await getText(SDK_MANIFEST, opts.timeoutMs ?? 30000);
  // Preview platforms use codenames (android-CANARY), so a numeric filter excludes them.
  const apis = [...xml.matchAll(/platforms;android-(\d+)/g)].map((m) => Number(m[1]));
  const buildTools = [...xml.matchAll(/build-tools;(\d[\d.]*)/g)].map((m) => m[1]);
  if (!apis.length) throw new Error('no platforms found in SDK manifest');
  return {
    compileSdk: Math.max(...apis),
    buildTools: buildTools.sort(compareVersions).pop() ?? null,
    source: SDK_MANIFEST,
  };
}

// --- Android Studio <-> AGP ---------------------------------------------------

/** Rows the user can choose from, newest first, annotated with what each implies. */
export function studioOptions(compat) {
  return compat.studio.map((s) => {
    const agp = compat.agp.find((a) => a.agpMajorMinor === s.agpMax);
    return {
      ...s,
      label: `${s.name} | ${s.version}`,
      gradle: agp?.minGradle ?? null,
      jdk: agp?.minJdk ?? null,
      maxCompileSdk: agp?.maxCompileSdk ?? null,
      compileSdkVerified: agp?.compileSdkVerified ?? false,
    };
  });
}

/** Match an installed Android Studio build number (e.g. "261.23567...") to a table row. */
export function studioFromBuild(buildNumber, compat) {
  const major = String(buildNumber ?? '').split('.')[0];
  if (!major) return null;
  // Several feature drops share a build prefix; the newest row for that prefix is the safe pick
  // only if we cannot tell them apart, so prefer the LOWEST agpMax to avoid over-promising.
  const rows = compat.studio.filter((s) => s.build === major);
  if (!rows.length) return null;
  return rows.reduce((lo, r) => (compareVersions(r.agpMax, lo.agpMax) < 0 ? r : lo), rows[0]);
}
