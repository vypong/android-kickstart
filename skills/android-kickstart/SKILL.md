---
name: android-kickstart
description: Scaffold a new Android project wired to the latest stable library versions (Compose, Hilt/Koin, Retrofit/Ktor, Room), resolved live from Maven and validated with a real Gradle build. Use when starting a new Android app, or when the user asks for a project skeleton, boilerplate, or "the latest versions" of the Android stack.
---

# android-kickstart

A standalone Node CLI does all the work. It needs no AI: it resolves versions over HTTP,
renders templates, and validates with Gradle. Your job is to collect the choices and run it —
do **not** hand-write `build.gradle.kts` or invent versions.

## Run it

Requires Node 18+. Once installed (`git clone`, then `npm link` inside the clone) the command
is on the user's PATH:

```bash
android-kickstart --yes --build \
  --name=MyApp --package=com.example.myapp \
  --di=hilt --network=retrofit --db=room \
  --out=./MyApp
```

If that command is not found but a checkout exists, run it directly — the tool has no
dependencies, so a clone is runnable as-is:

```bash
node /path/to/android-kickstart/bin/kickstart.mjs --yes --build ...
```

If neither is available, have the user install it first:

```bash
git clone https://github.com/vypong/android-kickstart.git
cd android-kickstart && npm link
```

Ask the user for anything not already stated, then pass it as flags:

| Flag | Options | Default |
|---|---|---|
| `--name` | app name, also the Gradle root project name | `MyApp` |
| `--package` | applicationId + namespace | `com.example.<name>` |
| `--di` | `hilt` · `koin` · `none` | `hilt` |
| `--network` | `retrofit` · `ktor` · `none` | `retrofit` |
| `--db` | `room` · `sqldelight` · `none` | `room` |
| `--prefs` | `datastore` · `none` | `datastore` |
| `--image` | `coil` · `glide` · `none` | `coil` |
| `--sample` | `yes` · `no` — Login+Home sample screens and tests | `yes` |
| `--min-sdk` | integer | `24` |
| `--out` | destination directory | `./<name>` |

Other flags: `--build` (run a real `assembleDebug` plus unit tests to prove the version set
composes), `--open` (open it in Android Studio), `--offline` (use the pinned known-good set
instead of hitting the network), `--force` (write into a non-empty directory), `--studio`
(cap AGP to what an installed IDE can open), and overrides `--compile-sdk` `--target-sdk`
`--java` `--gradle`.

Omit `--yes` to get interactive prompts instead of flags. `--help` lists everything.

## Rules

- **Always pass `--build`** unless the user says otherwise. A resolved set of "latest"
  versions is a hypothesis; only Gradle proves it composes.
- **Never edit the generated `libs.versions.toml` to fix a version by hand.** If a version is
  wrong, fix `catalog.json` in the tool so the next project is right too.
- If the build fails, read the first `e:` line. Re-run with `--offline` to fall back to the
  last known-good pinned set, then report which artifact broke.
- To only see current versions without generating anything: `android-kickstart --dry-run --yes`
- There is also a browser GUI, `android-kickstart-gui`. Only suggest it when the user would
  rather click than answer questions.

## What it generates

A single-module app: version catalog, Gradle wrapper, `local.properties` pointing at the
detected SDK, Compose + Material 3 theme, and a working end-to-end vertical slice
(login → home → `ViewModel` → repository → Room or in-memory) wired through the chosen DI
framework. It compiles and runs as-is; replace the sample slice with real features.
