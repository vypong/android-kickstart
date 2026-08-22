import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { render } from './render.mjs';

// template path -> destination path (relative to project root). `kt/` is remapped onto the
// package directory. A null destination means "skip unless its flag is on" (handled below).
const STATIC_FILES = [
  ['settings.gradle.kts.tmpl', 'settings.gradle.kts'],
  ['build.gradle.kts.tmpl', 'build.gradle.kts'],
  ['gradle.properties.tmpl', 'gradle.properties'],
  ['gitignore.tmpl', '.gitignore'],
  ['gradle/wrapper/gradle-wrapper.properties.tmpl', 'gradle/wrapper/gradle-wrapper.properties'],
  ['app/build.gradle.kts.tmpl', 'app/build.gradle.kts'],
  ['app/proguard-rules.pro.tmpl', 'app/proguard-rules.pro'],
  ['app/src/main/AndroidManifest.xml.tmpl', 'app/src/main/AndroidManifest.xml'],
  ['app/src/main/res/values/strings.xml.tmpl', 'app/src/main/res/values/strings.xml'],
  ['app/src/main/res/values/themes.xml.tmpl', 'app/src/main/res/values/themes.xml'],
];

// Kotlin sources: [template, path within the package, condition key (null = always), source set]
const KT_FILES = [
  ['kt/App.kt.tmpl', 'App.kt', null, 'main'],
  ['kt/MainActivity.kt.tmpl', 'MainActivity.kt', null, 'main'],

  ['kt/domain/model/Item.kt.tmpl', 'domain/model/Item.kt', 'store', 'main'],
  ['kt/domain/model/User.kt.tmpl', 'domain/model/User.kt', null, 'main'],
  ['kt/domain/repository/ItemRepository.kt.tmpl', 'domain/repository/ItemRepository.kt', 'store', 'main'],
  ['kt/domain/repository/AuthRepository.kt.tmpl', 'domain/repository/AuthRepository.kt', null, 'main'],

  ['kt/data/repository/DefaultItemRepository.kt.tmpl', 'data/repository/DefaultItemRepository.kt', 'room', 'main'],
  ['kt/data/repository/SqlDelightItemRepository.kt.tmpl', 'data/repository/DefaultItemRepository.kt', 'sqldelight', 'main'],
  ['kt/data/repository/DefaultAuthRepository.kt.tmpl', 'data/repository/DefaultAuthRepository.kt', null, 'main'],
  ['kt/data/local/ItemEntity.kt.tmpl', 'data/local/ItemEntity.kt', 'room', 'main'],
  ['kt/data/local/ItemDao.kt.tmpl', 'data/local/ItemDao.kt', 'room', 'main'],
  ['kt/data/local/AppDatabase.kt.tmpl', 'data/local/AppDatabase.kt', 'room', 'main'],
  ['kt/data/preferences/SessionDataSource.kt.tmpl', 'data/preferences/SessionDataSource.kt', 'prefs', 'main'],
  ['kt/data/remote/ApiClient.kt.tmpl', 'data/remote/ApiClient.kt', 'network', 'main'],
  ['kt/data/remote/ExampleApi.kt.tmpl', 'data/remote/ExampleApi.kt', 'network', 'main'],

  ['kt/ui/AppRoot.kt.tmpl', 'ui/AppRoot.kt', 'sample', 'main'],
  ['kt/ui/AppRootMinimal.kt.tmpl', 'ui/AppRoot.kt', 'noSample', 'main'],
  ['kt/ui/AppUiState.kt.tmpl', 'ui/AppUiState.kt', 'sample', 'main'],
  ['kt/ui/AppViewModel.kt.tmpl', 'ui/AppViewModel.kt', 'sample', 'main'],
  ['kt/ui/navigation/Routes.kt.tmpl', 'ui/navigation/Routes.kt', null, 'main'],
  ['kt/ui/login/LoginUiState.kt.tmpl', 'ui/login/LoginUiState.kt', 'sample', 'main'],
  ['kt/ui/login/LoginViewModel.kt.tmpl', 'ui/login/LoginViewModel.kt', 'sample', 'main'],
  ['kt/ui/login/LoginScreen.kt.tmpl', 'ui/login/LoginScreen.kt', 'sample', 'main'],
  ['kt/ui/home/HomeUiState.kt.tmpl', 'ui/home/HomeUiState.kt', 'sample', 'main'],
  ['kt/ui/home/HomeViewModel.kt.tmpl', 'ui/home/HomeViewModel.kt', 'sample', 'main'],
  ['kt/ui/home/HomeScreen.kt.tmpl', 'ui/home/HomeScreen.kt', 'sample', 'main'],
  ['kt/ui/theme/Color.kt.tmpl', 'ui/theme/Color.kt', null, 'main'],
  ['kt/ui/theme/Theme.kt.tmpl', 'ui/theme/Theme.kt', null, 'main'],
  ['kt/ui/theme/Type.kt.tmpl', 'ui/theme/Type.kt', null, 'main'],

  ['kt/di/AppModule.kt.tmpl', 'di/AppModule.kt', 'hiltAppModule', 'main'],
  ['kt/di/RepositoryModule.kt.tmpl', 'di/RepositoryModule.kt', 'hilt', 'main'],
  ['kt/di/KoinModule.kt.tmpl', 'di/KoinModule.kt', 'koin', 'main'],
  ['kt/di/ServiceLocator.kt.tmpl', 'di/ServiceLocator.kt', 'noDi', 'main'],

  ['kt/test/MainDispatcherRule.kt.tmpl', 'MainDispatcherRule.kt', 'sample', 'test'],
  ['kt/test/FakeItemRepository.kt.tmpl', 'data/repository/FakeItemRepository.kt', 'sampleStore', 'test'],
  ['kt/test/FakeAuthRepository.kt.tmpl', 'data/repository/FakeAuthRepository.kt', 'sample', 'test'],
  ['kt/test/LoginViewModelTest.kt.tmpl', 'ui/login/LoginViewModelTest.kt', 'sample', 'test'],
  ['kt/test/HomeViewModelTest.kt.tmpl', 'ui/home/HomeViewModelTest.kt', 'sample', 'test'],
];

export function buildContext(config, resolved) {
  const di = config.di ?? 'hilt';
  const network = config.network ?? 'retrofit';
  const db = config.db ?? 'room';
  const prefsChoice = config.prefs ?? 'datastore';
  // Sample screens are opt-out: most people want something that already runs.
  const sample = (config.sample ?? 'yes') !== 'no';

  const hilt = di === 'hilt';
  const koin = di === 'koin';
  const noDi = di === 'none';
  const room = db === 'room';
  const sqldelight = db === 'sqldelight';
  const image = config.image ?? 'coil';
  // DataStore is key-value settings storage. It is orthogonal to Room, not an alternative:
  // a project can legitimately use both, one, or neither.
  const prefs = prefsChoice === 'datastore';

  // AGP 9.0 ships built-in Kotlin support and REJECTS the org.jetbrains.kotlin.android plugin:
  // "The 'org.jetbrains.kotlin.android' plugin is no longer required for Kotlin support since AGP 9.0."
  const agpMajor = parseInt((resolved.agp?.version ?? '0').split('.')[0], 10);

  return {
    APP_NAME: config.appName,
    PACKAGE: config.packageName,
    MIN_SDK: config.minSdk,
    COMPILE_SDK: config.compileSdk,
    TARGET_SDK: config.targetSdk,
    JAVA_VERSION: config.javaVersion,
    GRADLE_VERSION: config.gradleVersion,

    agpBuiltInKotlin: agpMajor >= 9,

    hilt, koin, noDi,
    room, prefs,
    sqldelight, notSqldelight: !sqldelight,
    // The Item slice exists to demonstrate persistence. With no database selected it
    // teaches nothing the Auth slice does not already show, so it is left out.
    store: room || sqldelight,
    noStore: !room && !sqldelight,
    coil: image === 'coil', glide: image === 'glide', image: image !== 'none',
    sample, noSample: !sample,
    sampleStore: sample && (room || sqldelight),
    retrofit: network === 'retrofit',
    ktor: network === 'ktor',
    network: network !== 'none',

    // Hilt's @Provides module only exists if there is a framework type to provide.
    hiltAppModule: hilt && (room || sqldelight || prefs || network !== 'none'),
    // Which ViewModel accessor MainActivity uses for the settings ViewModel.
    prefsHilt: prefs && hilt,
    prefsKoin: prefs && koin,
    prefsNoDi: prefs && noDi,

    ksp: hilt || room,
    versions: Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.version])),
  };
}

function write(dest, content) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, 'utf8');
}

export function scaffold({ root, toolRoot, config, resolved, versionCatalog }) {
  const ctx = buildContext(config, resolved);
  const written = [];
  const tpl = (rel) => readFileSync(join(toolRoot, 'templates', rel), 'utf8');

  for (const [src, dest] of STATIC_FILES) {
    write(join(root, dest), render(tpl(src), ctx));
    written.push(dest);
  }

  const pkgSegments = config.packageName.split('.');
  for (const [src, dest, cond, sourceSet] of KT_FILES) {
    if (cond && !ctx[cond]) continue;
    const rel = join('app', 'src', sourceSet, 'java', ...pkgSegments, dest);
    write(join(root, rel), render(tpl(src), ctx));
    written.push(rel);
  }

  if (ctx.sqldelight) {
    const sq = join('app', 'src', 'main', 'sqldelight', ...pkgSegments, 'data', 'local', 'Item.sq');
    write(join(root, sq), render(tpl('sq/Item.sq.tmpl'), ctx));
    written.push(sq);
  }

  write(join(root, 'gradle', 'libs.versions.toml'), versionCatalog);
  written.push('gradle/libs.versions.toml');

  // Gradle wrapper: jar + launcher scripts are vendored, not generated.
  const wrapperDir = join(root, 'gradle', 'wrapper');
  mkdirSync(wrapperDir, { recursive: true });
  copyFileSync(join(toolRoot, 'vendor', 'gradle-wrapper.jar'), join(wrapperDir, 'gradle-wrapper.jar'));
  for (const f of ['gradlew', 'gradlew.bat']) {
    copyFileSync(join(toolRoot, 'vendor', f), join(root, f));
  }
  try { chmodSync(join(root, 'gradlew'), 0o755); } catch { /* windows */ }
  written.push('gradle/wrapper/gradle-wrapper.jar', 'gradlew', 'gradlew.bat');

  if (config.sdkDir) {
    // local.properties is machine-specific and gitignored. Java .properties treats both
    // backslash and colon as escapes, so a Windows path must be escaped before writing.
    const escaped = config.sdkDir.split('\\').join('\\\\').split(':').join('\\:');
    write(join(root, 'local.properties'), `sdk.dir=${escaped}\n`);
    written.push('local.properties');
  }

  if (ctx.room) mkdirSync(join(root, 'app', 'schemas'), { recursive: true });

  return { written, ctx };
}

/**
 * Finds installed Android Studio(s) by their product-info.json and returns the build number,
 * which maps to an AGP ceiling via compat.json. Several installs can coexist (and a partial
 * install may be missing product-info.json entirely), so every candidate is reported.
 */
export function detectStudios() {
  const roots = process.platform === 'win32'
    ? ['C:/Program Files/Android', 'C:/Program Files/JetBrains',
       process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : null]
    : process.platform === 'darwin'
      ? ['/Applications']
      : ['/opt', join(process.env.HOME ?? '', 'Applications')];

  const found = [];
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!/android\s*studio/i.test(name)) continue;
      const home = join(root, name);
      for (const rel of ['product-info.json', 'Contents/Resources/product-info.json']) {
        const info = join(home, rel);
        if (!existsSync(info)) continue;
        try {
          const parsed = JSON.parse(readFileSync(info, 'utf8'));
          found.push({ home, buildNumber: parsed.buildNumber, version: parsed.version });
        } catch { /* unreadable, skip */ }
        break;
      }
    }
  }
  return found;
}

/**
 * Gradle refuses to start if JAVA_HOME points at a directory without bin/java.
 * Android Studio's bundled JBR is a common offender (a partial install leaves bin/ with
 * only .dlls), so verify the executable exists rather than trusting the variable.
 */
export function detectJdk(minMajor = 17) {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const valid = (p) => p && existsSync(join(p, 'bin', exe));

  if (valid(process.env.JAVA_HOME)) return { home: process.env.JAVA_HOME, source: 'JAVA_HOME' };

  // A complete Android Studio JBR is the JDK Studio itself builds with, so try those first.
  for (const s of detectStudios()) {
    const jbr = join(s.home, 'jbr');
    const macJbr = join(s.home, 'Contents', 'jbr', 'Contents', 'Home');
    if (valid(jbr)) return { home: jbr, source: `Android Studio JBR (${s.buildNumber})` };
    if (valid(macJbr)) return { home: macJbr, source: `Android Studio JBR (${s.buildNumber})` };
  }

  const roots = process.platform === 'win32'
    ? ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Microsoft']
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];

  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const home = join(root, name);
      const mac = join(home, 'Contents', 'Home');
      const candidate = valid(home) ? home : (valid(mac) ? mac : null);
      if (!candidate) continue;
      const major = parseInt((name.match(/(\d+)/) ?? [])[1] ?? '0', 10);
      if (major >= minMajor) found.push({ home: candidate, major });
    }
  }
  found.sort((a, b) => b.major - a.major);
  return found[0] ? { home: found[0].home, source: `detected JDK ${found[0].major}` } : null;
}

export function detectSdkDir() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    // Windows
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    // macOS - note the lowercase "sdk", and it is under Library, not the home root
    home ? join(home, 'Library', 'Android', 'sdk') : null,
    // Linux
    home ? join(home, 'Android', 'Sdk') : null,
    home ? join(home, 'Android', 'sdk') : null,
  ].filter(Boolean).map((p) => p.split('\\:').join(':'));
  return candidates.find((p) => existsSync(join(p, 'platform-tools'))) ?? null;
}

/**
 * Launches Android Studio on a generated project. Detached and unref'd so the tool can exit
 * without taking the IDE with it. Returns what it did, so the caller can report honestly
 * rather than claiming success when no IDE was found.
 */
export function openInStudio(projectDir, spawn) {
  const studio = detectStudios()[0];
  if (!studio) return { opened: false, reason: 'no Android Studio installation found' };

  let cmd, args;
  if (process.platform === 'win32') {
    cmd = join(studio.home, 'bin', 'studio64.exe');
    if (!existsSync(cmd)) cmd = join(studio.home, 'bin', 'studio.exe');
    args = [projectDir];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = ['-a', studio.home, projectDir];
  } else {
    cmd = join(studio.home, 'bin', 'studio.sh');
    args = [projectDir];
  }

  if (process.platform !== 'darwin' && !existsSync(cmd)) {
    return { opened: false, reason: `launcher not found at ${cmd}` };
  }

  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return { opened: true, via: cmd };
  } catch (e) {
    return { opened: false, reason: e.message };
  }
}
