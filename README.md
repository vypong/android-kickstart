<div align="center">

<img src="gui/logos/appmark.svg" width="72" height="72" alt="">

# android-kickstart

**Pulls the latest Android dependencies and kickstarts a project in seconds.**

</div>

![The android-kickstart GUI](docs/gui.png)

## What it does

- Looks up the current version of every library, live from Maven. No copying numbers out of blog posts.
- Caps the Android Gradle Plugin to what your installed Android Studio can actually open.
- Builds the project before handing it over, so you know the versions work together.
- Gives you a real app, not an empty folder: login screen, home screen, DI, tests.

Pick your stack, press a button, get a project that runs.

## Install

You need [Node 18+](https://nodejs.org).

```bash
git clone https://github.com/vypong/android-kickstart.git
cd android-kickstart
npm link
```

Works on macOS, Windows and Linux.

## Use it

### The easy way

```bash
android-kickstart-gui
```

That is the whole thing. It opens in your browser, picks up your Android Studio, SDK and JDK,
and starts on a preset that already builds. Press **Set up project** and it lands in Android
Studio a second later.

Three presets to start from, then change anything:

| Preset | What you get |
|---|---|
| **Standard app** | Hilt, Retrofit, Room, DataStore, Coil. What most teams ship. |
| **Multiplatform-ready** | Koin, Ktor, SQLDelight. Pure Kotlin, so the data layer can move to iOS. |
| **Minimal shell** | Compose and a ServiceLocator. No libraries to argue about. |

### Or stay in the terminal

```bash
android-kickstart
```

One question at a time, each option explained as it goes, project written to the current
directory. Nothing to look up.

Say it in one line instead, which is what CI does:

```bash
android-kickstart --yes --build --open --name=MyApp --di=koin --db=sqldelight
```

| Flag | Choices | Default |
|---|---|---|
| `--name` | app and Gradle project name | `MyApp` |
| `--package` | applicationId and namespace | `com.example.<name>` |
| `--di` | `hilt` · `koin` · `none` | `hilt` |
| `--network` | `retrofit` · `ktor` · `none` | `retrofit` |
| `--db` | `room` · `sqldelight` · `none` | `room` |
| `--prefs` | `datastore` · `none` | `datastore` |
| `--image` | `coil` · `glide` · `none` | `coil` |
| `--sample` | `yes` · `no` | `yes` |
| `--min-sdk` | any API level | `24` |
| `--studio` | name, version, AGP, or `latest` | your installed IDE |
| `--out` | where to write it | `./<name>` |

Add `--build` to compile it before you open it, `--open` to launch Android Studio, `--offline`
to use the last known-good versions without touching the network.

Every option sits behind an interface, so swapping one later is a small change.

### Worth knowing

```bash
android-kickstart help              # everything, with worked examples
android-kickstart --dry-run --yes   # show the versions you would get, write nothing
android-kickstart --list-studios    # which Android Studio opens which AGP
android-kickstart --info=koin       # what a library is, and what it costs you
```

## What you get

```
domain/   models and repository interfaces, no Android imports
data/     local, preferences, remote, repository implementations
ui/       login, home, navigation, theme
di/       Hilt modules, a Koin module, or a plain ServiceLocator
test/     fakes and ViewModel tests
```

A login screen with validation and error states leads to a home screen. Auth goes through an
`AuthRepository` with a stub sign-in. Replace the body of `signIn` with your backend and
nothing above it changes.

Also included: an `Application` class wired into the manifest, type-safe navigation routes,
immutable UI state, `@Preview` composables, a version catalog using BOMs and bundles, and
unit tests that pass.

## Why "just take the newest version" does not work

Every one of these is real, and each is handled:

| Trap | Reality |
|---|---|
| The `<release>` field in Maven metadata | Kotlin's currently points at a release candidate |
| Taking the last version listed | AGP's last four are alphas and release candidates |
| Sorting as SemVer | Compose BOM uses calendar versions like `2026.08.00` |
| Sorting as text | Ranks `2.8.4` above `2.8.10` |
| Checking one repository | Hilt is on Maven Central only |
| Trusting the first repo that answers | Google Maven serves a KSP plugin marker frozen in 2021 |
| Assuming a plugin matches its library | kotlinx-serialization's plugin tracks the Kotlin compiler |
| Reading compileSdk from AGP | Current AndroidX needs a newer platform than AGP ships with |

Two things have no machine-readable source at all, so the tool warns instead of guessing: the
AGP to Gradle to JDK floors, and Kotlin to KSP pairing. Only a real build settles those, which
is what `--build` is for.

## Use it from Claude Code

The same tool, driven by Claude. It asks what you want, then runs the CLI — no hand-written
`build.gradle.kts`, no invented version numbers.

```
/plugin marketplace add vypong/android-kickstart
/plugin install android-kickstart
```

Then just say what you want: *"new Android app called Ledger, Koin and Ktor, build it"*.

## Tests

```bash
npm test        # unit tests and config audit, instant
npm run matrix  # 13 combinations, real Gradle builds
```

The full product of all options is 324 builds, so the matrix uses all-pairs coverage instead:
13 projects where every pair of options appears together at least once. It fails on Kotlin
warnings as well as errors, because a deprecation today is a compile error later.

CI runs on Ubuntu, macOS and Windows on every push.

## Licence

MIT, see [LICENSE](LICENSE). Third-party marks are credited in [NOTICE.md](NOTICE.md).
Not affiliated with Google.
