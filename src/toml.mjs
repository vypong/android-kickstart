// Emits gradle/libs.versions.toml from a resolved version map.
//
// Two things keep the generated build file short:
//   BOMs    - Compose, Koin, Ktor and OkHttp each publish one, so their member artifacts
//             carry no version at all and can never drift apart from each other.
//   Bundles - related aliases are grouped so build.gradle.kts asks for one thing, not eight.

// { when: resolved key that must be present, alias, module, ref: version ref or null when a
//   BOM supplies the version }
const LIBRARIES = [
  { when: 'coreKtx', alias: 'androidx-core-ktx', module: 'androidx.core:core-ktx', ref: 'coreKtx' },
  { when: 'coroutines', alias: 'kotlinx-coroutines-android', module: 'org.jetbrains.kotlinx:kotlinx-coroutines-android', ref: 'coroutines' },
  { when: 'kotlinxSerialization', alias: 'kotlinx-serialization-json', module: 'org.jetbrains.kotlinx:kotlinx-serialization-json', ref: 'kotlinxSerialization' },

  // Compose: the BOM sets every member version.
  { when: 'composeBom', alias: 'androidx-compose-bom', module: 'androidx.compose:compose-bom', ref: 'composeBom' },
  { when: 'composeBom', alias: 'androidx-ui', module: 'androidx.compose.ui:ui', ref: null },
  { when: 'composeBom', alias: 'androidx-ui-graphics', module: 'androidx.compose.ui:ui-graphics', ref: null },
  { when: 'composeBom', alias: 'androidx-ui-tooling', module: 'androidx.compose.ui:ui-tooling', ref: null },
  { when: 'composeBom', alias: 'androidx-ui-tooling-preview', module: 'androidx.compose.ui:ui-tooling-preview', ref: null },
  { when: 'composeBom', alias: 'androidx-material3', module: 'androidx.compose.material3:material3', ref: null },
  { when: 'composeBom', alias: 'androidx-material-icons-core', module: 'androidx.compose.material:material-icons-core', ref: null },
  { when: 'activityCompose', alias: 'androidx-activity-compose', module: 'androidx.activity:activity-compose', ref: 'activityCompose' },
  { when: 'lifecycleViewmodelCompose', alias: 'androidx-lifecycle-viewmodel-compose', module: 'androidx.lifecycle:lifecycle-viewmodel-compose', ref: 'lifecycleViewmodelCompose' },
  { when: 'lifecycleRuntimeCompose', alias: 'androidx-lifecycle-runtime-compose', module: 'androidx.lifecycle:lifecycle-runtime-compose', ref: 'lifecycleRuntimeCompose' },
  { when: 'navigationCompose', alias: 'androidx-navigation-compose', module: 'androidx.navigation:navigation-compose', ref: 'navigationCompose' },

  // Hilt publishes no BOM.
  { when: 'hilt', alias: 'hilt-android', module: 'com.google.dagger:hilt-android', ref: 'hilt' },
  { when: 'hilt', alias: 'hilt-compiler', module: 'com.google.dagger:hilt-android-compiler', ref: 'hilt' },
  { when: 'hiltNavigationCompose', alias: 'androidx-hilt-navigation-compose', module: 'androidx.hilt:hilt-navigation-compose', ref: 'hiltNavigationCompose' },
  { when: 'hiltLifecycleViewmodelCompose', alias: 'androidx-hilt-lifecycle-viewmodel-compose', module: 'androidx.hilt:hilt-lifecycle-viewmodel-compose', ref: 'hiltLifecycleViewmodelCompose' },

  // Koin ships a BOM.
  { when: 'koinBom', alias: 'koin-bom', module: 'io.insert-koin:koin-bom', ref: 'koinBom' },
  { when: 'koinBom', alias: 'koin-android', module: 'io.insert-koin:koin-android', ref: null },
  { when: 'koinBom', alias: 'koin-androidx-compose', module: 'io.insert-koin:koin-androidx-compose', ref: null },

  // Retrofit has no BOM; OkHttp does, and Retrofit pulls OkHttp in.
  { when: 'retrofit', alias: 'retrofit', module: 'com.squareup.retrofit2:retrofit', ref: 'retrofit' },
  { when: 'retrofit', alias: 'retrofit-serialization', module: 'com.squareup.retrofit2:converter-kotlinx-serialization', ref: 'retrofit' },
  { when: 'okhttpBom', alias: 'okhttp-bom', module: 'com.squareup.okhttp3:okhttp-bom', ref: 'okhttpBom' },
  { when: 'okhttpBom', alias: 'okhttp', module: 'com.squareup.okhttp3:okhttp', ref: null },
  { when: 'okhttpBom', alias: 'okhttp-logging', module: 'com.squareup.okhttp3:logging-interceptor', ref: null },

  // Ktor ships a BOM.
  { when: 'ktorBom', alias: 'ktor-bom', module: 'io.ktor:ktor-bom', ref: 'ktorBom' },
  { when: 'ktorBom', alias: 'ktor-client-core', module: 'io.ktor:ktor-client-core', ref: null },
  { when: 'ktorBom', alias: 'ktor-client-okhttp', module: 'io.ktor:ktor-client-okhttp', ref: null },
  { when: 'ktorBom', alias: 'ktor-client-content-negotiation', module: 'io.ktor:ktor-client-content-negotiation', ref: null },
  { when: 'ktorBom', alias: 'ktor-serialization-kotlinx-json', module: 'io.ktor:ktor-serialization-kotlinx-json', ref: null },

  { when: 'room', alias: 'androidx-room-runtime', module: 'androidx.room:room-runtime', ref: 'room' },
  { when: 'room', alias: 'androidx-room-ktx', module: 'androidx.room:room-ktx', ref: 'room' },
  { when: 'room', alias: 'androidx-room-compiler', module: 'androidx.room:room-compiler', ref: 'room' },

  // Coil ships a BOM; Glide's Compose integration is versioned separately from Glide core.
  { when: 'coilBom', alias: 'coil-bom', module: 'io.coil-kt.coil3:coil-bom', ref: 'coilBom' },
  { when: 'coilBom', alias: 'coil-compose', module: 'io.coil-kt.coil3:coil-compose', ref: null },
  { when: 'coilBom', alias: 'coil-network-okhttp', module: 'io.coil-kt.coil3:coil-network-okhttp', ref: null },
  { when: 'glide', alias: 'glide', module: 'com.github.bumptech.glide:glide', ref: 'glide' },
  { when: 'glideCompose', alias: 'glide-compose', module: 'com.github.bumptech.glide:compose', ref: 'glideCompose' },

  { when: 'sqldelight', alias: 'sqldelight-android-driver', module: 'app.cash.sqldelight:android-driver', ref: 'sqldelight' },
  { when: 'sqldelight', alias: 'sqldelight-coroutines', module: 'app.cash.sqldelight:coroutines-extensions', ref: 'sqldelight' },

  { when: 'datastore', alias: 'androidx-datastore-preferences', module: 'androidx.datastore:datastore-preferences', ref: 'datastore' },

  { when: 'junit', alias: 'junit', module: 'junit:junit', ref: 'junit' },
  { when: 'coroutinesTest', alias: 'kotlinx-coroutines-test', module: 'org.jetbrains.kotlinx:kotlinx-coroutines-test', ref: 'coroutinesTest' },
  { when: 'turbine', alias: 'turbine', module: 'app.cash.turbine:turbine', ref: 'turbine' },
  { when: 'androidxTestJunit', alias: 'androidx-junit', module: 'androidx.test.ext:junit', ref: 'androidxTestJunit' },
  { when: 'espresso', alias: 'androidx-espresso-core', module: 'androidx.test.espresso:espresso-core', ref: 'espresso' },
];

// Aliases grouped so the build file asks for one bundle instead of a column of dependencies.
// Members not present in this project are dropped; empty bundles are not emitted at all.
// Annotation processors and BOMs stay out - they need ksp()/platform(), not implementation().
const BUNDLES = {
  compose: [
    'androidx-ui', 'androidx-ui-graphics', 'androidx-ui-tooling-preview', 'androidx-material3',
    'androidx-material-icons-core', 'androidx-activity-compose',
    'androidx-lifecycle-viewmodel-compose', 'androidx-lifecycle-runtime-compose',
    'androidx-navigation-compose',
  ],
  hilt: ['hilt-android', 'androidx-hilt-navigation-compose', 'androidx-hilt-lifecycle-viewmodel-compose'],
  koin: ['koin-android', 'koin-androidx-compose'],
  retrofit: ['retrofit', 'retrofit-serialization', 'okhttp', 'okhttp-logging'],
  ktor: ['ktor-client-core', 'ktor-client-okhttp', 'ktor-client-content-negotiation', 'ktor-serialization-kotlinx-json'],
  room: ['androidx-room-runtime', 'androidx-room-ktx'],
  sqldelight: ['sqldelight-android-driver', 'sqldelight-coroutines'],
  coil: ['coil-compose', 'coil-network-okhttp'],
  glide: ['glide', 'glide-compose'],
  'unit-test': ['junit', 'kotlinx-coroutines-test', 'turbine'],
  'android-test': ['androidx-junit', 'androidx-espresso-core'],
};

// [alias, plugin id, version ref]
const PLUGINS = [
  ['agp', 'android-application', 'com.android.application', 'agp'],
  ['kotlin', 'kotlin-android', 'org.jetbrains.kotlin.android', 'kotlin'],
  ['composeCompiler', 'kotlin-compose', 'org.jetbrains.kotlin.plugin.compose', 'composeCompiler'],
  // NOTE: version ref is `kotlin`, not `kotlinxSerialization` - the plugin tracks the compiler.
  ['kotlinxSerialization', 'kotlin-serialization', 'org.jetbrains.kotlin.plugin.serialization', 'kotlin'],
  ['ksp', 'ksp', 'com.google.devtools.ksp', 'ksp'],
  ['hilt', 'hilt', 'com.google.dagger.hilt.android', 'hilt'],
  ['room', 'room', 'androidx.room', 'room'],
  ['sqldelight', 'sqldelight', 'app.cash.sqldelight', 'sqldelight'],
];

export function renderVersionCatalog(results, { generatedAt = new Date().toISOString() } = {}) {
  const has = (k) => Boolean(results[k]);
  const out = [];

  out.push(`# Generated by android-kickstart on ${generatedAt}`);
  out.push('# Latest stable releases resolved from Maven metadata. Do not hand-edit a version');
  out.push('# here to fix a build - fix it in the generator so the next project is right too.');
  out.push('');

  out.push('[versions]');
  for (const key of Object.keys(results).sort()) {
    const r = results[key];
    out.push(`${key} = "${r.version}"${r.derivedFrom ? ` # == ${r.derivedFrom}` : ''}`);
  }

  out.push('');
  out.push('[libraries]');
  const emitted = new Set();
  for (const lib of LIBRARIES) {
    if (!has(lib.when) || emitted.has(lib.alias)) continue;
    emitted.add(lib.alias);
    out.push(lib.ref
      ? `${lib.alias} = { module = "${lib.module}", version.ref = "${lib.ref}" }`
      : `${lib.alias} = { module = "${lib.module}" } # version from the BOM`);
  }

  const bundles = Object.entries(BUNDLES)
    .map(([name, members]) => [name, members.filter((m) => emitted.has(m))])
    .filter(([, members]) => members.length > 1);

  if (bundles.length) {
    out.push('');
    out.push('[bundles]');
    for (const [name, members] of bundles) {
      out.push(`${name} = [${members.map((m) => `"${m}"`).join(', ')}]`);
    }
  }

  out.push('');
  out.push('[plugins]');
  for (const [when, alias, id, ref] of PLUGINS) {
    if (!has(when) || !has(ref)) continue;
    out.push(`${alias} = { id = "${id}", version.ref = "${ref}" }`);
  }

  return out.join('\n') + '\n';
}
