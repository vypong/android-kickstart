# android-kickstart

Scaffolds a runnable Android project wired to the **latest stable** versions of the stack,
resolved live from Maven metadata and proven by a real Gradle build.

Zero dependencies. No build step. No AI at runtime — it is HTTP requests, string templates,
and `gradlew`.

```
android-kickstart --yes --build --name=MyApp --di=hilt --db=room --image=coil
```

## Install

```bash
cd android-kickstart && npm link
```

That puts `android-kickstart`, `android-kickstart-gui` and `android-versions` on your PATH, so they work from any
directory in PowerShell, CMD, Git Bash, or Windows Terminal. Undo with `npm unlink -g android-kickstart`.

Without linking, just call it by path: `node path/to/bin/kickstart.mjs`.

```bash
android-kickstart                           # interactive prompts
android-kickstart --yes --build \
  --name=MyApp --package=com.example.myapp \
  --di=hilt --network=retrofit --db=room \
  --out=../MyApp
```

Colour is emitted only to a real terminal — piping to a file or a log gives plain text.
`NO_COLOR=1` disables it, `FORCE_COLOR=1` forces it on.

| Flag | Options | Default |
|---|---|---|
| `--name` | app + Gradle root project name | `MyApp` |
| `--package` | applicationId and namespace | `com.example.myapp` |
| `--di` | `hilt` · `koin` · `none` | `hilt` |
| `--network` | `retrofit` · `ktor` · `none` | `retrofit` |
| `--db` | `room` · `sqldelight` · `none` | `room` |
| `--prefs` | `datastore` · `none` — key-value | `datastore` |
| `--image` | `coil` · `glide` · `none` | `coil` |
| `--sample` | `yes` · `no` — Login/Home screens + tests | `yes` |
| `--studio` | name, version, AGP, or `latest` | detected IDE |
| `--min-sdk` | integer | `24` |
| `--build` | run `assembleDebug` + unit tests | off |
| `--offline` | use `pinned.json`, no network | off |
| `--force` | write into a non-empty directory | off |

Overrides: `--compile-sdk` `--target-sdk` `--java` `--gradle` `--out` `--sdk-dir`.

Version lookup on its own, no scaffolding:

```bash
node bin/resolve.mjs --print-toml           # resolved gradle/libs.versions.toml
node bin/resolve.mjs --verify-plugins       # check every Gradle plugin marker resolves
node bin/resolve.mjs --pin                  # snapshot the current set to pinned.json
```

## GUI

```bash
android-kickstart-gui        # opens a local page in your browser
```

Running `android-kickstart-gui` starts a local server on 127.0.0.1 and opens your browser.
It shuts itself down a few seconds after you close the tab, so nothing is left running
(`--keep-alive` if you would rather it stay up).

**Why a server at all?** The page is only the rendering layer. A browser cannot read your
filesystem to find Android Studio, write 45 files to a folder you picked, run Gradle, or
launch the IDE — and Maven Central and Google Maven send no CORS headers, so a `file://`
page cannot even fetch the version data. Everything the tool actually does happens in Node.

Built to **Material Design 3** — M3 colour roles, type scale, shape and elevation tokens,
filter chips, outlined text fields and state layers, implemented in plain CSS rather than
Material Web Components so the page stays one offline file. Roboto and Roboto Mono are
vendored alongside the logos, so nothing is fetched at runtime.

Same options as the CLI, plus a live `libs.versions.toml` preview that re-resolves as you
change choices, a native folder picker, a streaming build log, and detected SDK/JDK/Studio
paths in the top bar with an install guide when something is missing.

The CLI mirrors every GUI affordance: `--list-studios`, `--list-libs`, `--info=koin`,
`--dry-run`. Both read the same `libraries.json` and `compat.json`, so they cannot drift.

## What it generates

Single-module app, ~45 files, laid out for modern Android:

```
domain/   model + repository interfaces      (no Android dependencies)
data/     local (Room) · preferences (DataStore) · remote · repository impls
ui/       login/ · home/ · navigation/ · theme/   + AppRoot, AppViewModel
di/       Hilt modules, Koin module, or a hand-rolled ServiceLocator
test/     fakes + ViewModel tests (JUnit, coroutines-test, Turbine)
```

A **Login screen** (validation, loading and error states) leads to a **Home screen**
(greeting, item list, sign out). Auth goes through an `AuthRepository` interface with a
clearly-labelled stub implementation — swap the body of `signIn` for your backend and nothing
above it changes. Choosing DataStore persists the session, so the app reopens straight to
Home; choosing none keeps it in memory for the process lifetime.

Also generated: an `Application` subclass wired into the manifest (`@HiltAndroidApp`,
`startKoin {}`, or `ServiceLocator.init`), type-safe `@Serializable` navigation routes,
immutable `UiState` per screen, stateless composables with `@Preview`, and 8 unit tests
that `--build` runs for you.

With `--di=none` there is no framework: a hand-rolled `ServiceLocator` is generated instead.

## The options

| | Choices | Notes |
|---|---|---|
| **DI** | Hilt · Koin · none | Koin uses its BOM; `none` generates a hand-rolled `ServiceLocator` |
| **Networking** | Retrofit · Ktor · none | both wired to kotlinx.serialization |
| **Database** | Room · SQLDelight · none | `none` gives an in-memory repository behind the same interface |
| **Preferences** | DataStore · none | backs the session, so sign-in survives a restart |
| **Image loading** | Coil · Glide · none | Coil is the Compose-native choice; Glide's Compose API is still beta |
| **Sample code** | include · empty shell | Login + Home + 5 tests, or just the wiring |

Deliberately excluded: **Realm** — MongoDB ended mobile support on 30 September 2025.

## Bundles and BOMs

The generated catalog uses both, so the build file stays short and families cannot drift:

- **BOMs** for Compose, Koin, Ktor and OkHttp — their member artifacts carry no version at
  all. Hilt and Retrofit publish none, so those keep explicit version refs.
- **`[bundles]`** grouping related aliases, so `build.gradle.kts` reads
  `implementation(libs.bundles.compose)` rather than nine separate lines.

Annotation processors stay out of the bundles — they need `ksp(...)`, not `implementation`.

## Why "take the newest version" is wrong

Every row below is a live trap, each verified against the real repositories:

| Trap | Reality |
|---|---|
| `<release>` in maven-metadata | Kotlin's points at `2.4.20-RC`. Never trusted. |
| Last `<version>` entry | AGP's last four are alpha/rc. Naive `tail -1` gives `9.5.0-alpha02`. |
| SemVer sorting | Compose BOM is CalVer (`2026.08.00`). Segment-wise numeric compare handles both. |
| Lexicographic sorting | Ranks `2.8.4` above `2.8.10`. |
| One repository | Hilt is Central-only; `dl.google.com` 404s for `com.google.dagger`. |
| First repo that answers | **Google Maven mirrors a stale KSP plugin marker frozen at `1.5.30-1.0.0` (2021).** All repos are checked; stale mirrors are named in the output. |
| Plugin version == library version | The kotlinx-serialization *plugin* tracks the Kotlin compiler, not the library. |
| Fetching everything | The Compose compiler plugin version *equals* the Kotlin version. Derived, never fetched. |
| `compileSdk` from AGP | Wrong. 16 current libraries demand `compileSdk 37` while AGP 9.3 ships build-tools 36. Read from Google's SDK manifest instead. |

## What HTTP cannot answer

Two things have no machine-readable source, so the tool warns instead of guessing:

- **AGP ↔ Gradle ↔ JDK floors.** `compat.json` is a small hand-maintained table with a
  `_lastVerified` date. An unrecognised AGP version produces a warning, not a guess.
- **Kotlin ↔ KSP pairing.** KSP 2.x versions independently of Kotlin, so nothing in the
  metadata proves a given pair works together.

Only a real build settles either. That is what `--build` is for, and why `pinned.json`
exists as the fallback when a fresh resolve produces a set that does not compose.

## Tests

```bash
npm test              # 11 unit tests, no network, instant
npm run matrix:quick  # 3 stack combinations, real Gradle builds
npm run matrix        # all 36 combinations
```

The full matrix takes roughly 15-20 minutes with warm Gradle caches (much longer on a cold
cache, since the first run downloads the Gradle distribution and every dependency). Slice it
if you need it to fit a shorter window:

```bash
node test/matrix.mjs --start=0  --limit=9
node test/matrix.mjs --start=9  --limit=9
node test/matrix.mjs --start=18 --limit=9
```

`test/matrix.mjs` is the real regression suite: it generates every
`di × network × db × prefs` combination (36) and builds each one, running the generated
unit tests too. Add `--stop-daemons` on a memory-constrained machine — each Gradle daemon
holds ~2 GB and several can end up resident at once. Run it after upstream releases —
it is what catches breaking changes like AGP 9.0 removing Kotlin Gradle Plugin support.
