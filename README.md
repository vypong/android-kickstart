<div align="center">

<img src="gui/logos/appmark.svg" width="72" height="72" alt="">

# android-kickstart

**Start an Android project on today's libraries, not last year's.**

Resolves every version live from Maven, then proves the combination compiles
by running a real Gradle build before it hands you the project.

</div>

---

## Why this exists

Starting an Android project means half an hour of the same chores. Open Android Studio, take
whatever template it gives you, then go and look up the current version of Hilt. And Room.
And Retrofit. Check whether this Compose BOM works with that Kotlin. Discover your Android
Studio is one release behind and cannot open the AGP you just pinned. Delete a sample screen
you never wanted.

You can automate the lookups, but "latest" is a trap. `maven-metadata.xml` has a `<release>`
field that lies — Kotlin's currently points at a release candidate. Google Maven serves a
KSP plugin marker frozen in 2021. Compose BOM uses calendar versions, so sorting it as SemVer
gives you nonsense. And even a perfect set of latest versions can simply fail to compile
together.

So this tool does the boring part properly: it reads the real metadata, applies the rules that
make "latest stable" actually mean that, and then **builds the project to prove it**. If the
combination does not compile, you find out in ninety seconds rather than after you have
started writing features.

## What you get

A single-module app laid out the way Android's own guidance suggests:

```
domain/   models and repository interfaces      (no Android imports at all)
data/     local · preferences · remote · repository implementations
ui/       login/ · home/ · navigation/ · theme/   + AppRoot, AppViewModel
di/       Hilt modules, a Koin module, or a hand-rolled ServiceLocator
test/     fakes and ViewModel tests
```

It runs the moment it is generated. A **Login screen** with validation, loading and error
states leads to a **Home screen**. Authentication goes through an `AuthRepository` interface
with a clearly-labelled stub — replace the body of `signIn` with your backend and nothing
above it changes.

Also in the box: an `Application` subclass wired into the manifest, type-safe `@Serializable`
navigation routes, immutable `UiState` per screen, stateless composables with `@Preview`, a
version catalog using BOMs and bundles, and unit tests that pass.

Prefer an empty shell? Turn the sample off and keep every bit of the wiring.

## Install

You need [Node 18+](https://nodejs.org). That is the only prerequisite for the tool itself —
Android Studio and a JDK are needed to *build* what it generates, and it will tell you if
either is missing.

```bash
git clone https://github.com/vypong/android-kickstart.git
cd android-kickstart
npm link
```

`npm link` puts three commands on your PATH. Undo it any time with
`npm unlink -g android-kickstart`.

<details>
<summary>Not keen on <code>npm link</code>?</summary>

Skip it and call the scripts by path — there are no dependencies to install:

```bash
node /path/to/android-kickstart/bin/kickstart.mjs
node /path/to/android-kickstart/bin/gui.mjs
```
</details>

Works on macOS, Windows and Linux. It finds your Android Studio, SDK and JDK in the usual
place for your platform, and says so plainly when it cannot.

## Use it

### The GUI

```bash
android-kickstart-gui
```

Opens a local page in your browser. Pick your options and watch the version catalog resolve
live as you change them; hover any library for what it is and what it costs you. Press
**Set up project** and it writes the files and opens them in Android Studio.

It shuts itself down a few seconds after you close the tab, so nothing is left running.

### The CLI

```bash
android-kickstart
```

With no arguments it asks you about each choice and explains the options as it goes. Or say
exactly what you want:

```bash
android-kickstart --yes --build --open \
  --name=MyApp --package=com.example.myapp \
  --di=hilt --network=retrofit --db=room --prefs=datastore --image=coil \
  --out=~/StudioProjects/MyApp
```

Useful things to know:

```bash
android-kickstart help              # everything, with worked examples
android-kickstart --dry-run --yes   # show the versions you would get, write nothing
android-kickstart --list-studios    # which Android Studio can open which AGP
android-kickstart --info=koin       # what a library is, and what it trades away
android-kickstart --yes --offline   # use the last known-good set, no network
```

## The choices

| | Options | Notes |
|---|---|---|
| **Dependency injection** | Hilt · Koin · none | `none` generates a hand-rolled `ServiceLocator` — the UI never notices |
| **Networking** | Retrofit · Ktor · none | both wired to kotlinx.serialization |
| **Database** | Room · SQLDelight · none | |
| **Preferences** | DataStore · none | backs the session, so signing in survives a restart |
| **Image loading** | Coil · Glide · none | Coil is the Compose-native one; Glide's Compose API is still beta |
| **Sample code** | include · empty shell | Login + Home + tests, or just the wiring |

Every option depends on an interface, so swapping one later is a one-file change.

Deliberately absent: **Realm**. MongoDB ended mobile support on 30 September 2025.

## Your Android Studio decides the ceiling

An Android Studio release can only open Android Gradle Plugin versions up to a point. Pin AGP
above that and the IDE refuses the project — which is a miserable way to start.

So the tool detects your installed Studio and caps AGP to match. Running Quail 2026.1.1? You
get AGP 9.2 and Gradle 9.4.1, not the 9.3 that just shipped. Override with `--studio=latest`,
or pick any release by name:

```bash
android-kickstart --list-studios
android-kickstart --yes --studio=Narwhal      # or =2025.1.1, or =8.13
```

## Why "just take the newest" does not work

Every row below is a live trap, each verified against the real repositories:

| Trap | Reality |
|---|---|
| `<release>` in maven-metadata | Kotlin's points at `2.4.20-RC`. Never trusted. |
| Last `<version>` entry | AGP's last four are alpha and rc. `tail -1` gives you `9.5.0-alpha02`. |
| SemVer sorting | Compose BOM is CalVer (`2026.08.00`). Segment-wise numeric compare handles both. |
| Lexicographic sorting | Ranks `2.8.4` above `2.8.10`. |
| One repository | Hilt is Central-only; `dl.google.com` 404s for `com.google.dagger`. |
| First repo that answers | **Google Maven mirrors a stale KSP plugin marker frozen at `1.5.30-1.0.0` (2021).** Every repo is checked, and stale mirrors are named in the output. |
| Plugin version == library version | The kotlinx-serialization *plugin* tracks the Kotlin compiler, not the library. |
| Fetching everything | The Compose compiler plugin version *equals* the Kotlin version. Derived, never fetched. |
| `compileSdk` from AGP | Wrong. Current AndroidX releases demand a platform newer than AGP's own build-tools. Read Google's SDK manifest instead. |

Two things have no machine-readable source at all, so the tool warns rather than guessing:
the **AGP ↔ Gradle ↔ JDK floors** (a small hand-maintained table with a `_lastVerified` date)
and **Kotlin ↔ KSP pairing** (KSP 2.x versions independently now). Only a real build settles
either — which is exactly what `--build` is for, and why `pinned.json` exists as a fallback.

## Bundles and BOMs

The generated catalog uses both, so the build file stays short and library families cannot
drift apart:

```kotlin
implementation(platform(libs.androidx.compose.bom))
implementation(libs.bundles.compose)
```

BOMs for Compose, Koin, Ktor, OkHttp and Coil — their member artifacts carry no version at
all. Hilt and Retrofit publish none, so those keep explicit version refs. Annotation
processors stay out of the bundles; they need `ksp(...)`, not `implementation`.

## Contributing, or just poking at it

```bash
npm test        # unit tests + config audit, no network, instant
npm run audit   # scaffold the risky configs, check nothing leaked
npm run matrix  # 13 pairwise combinations, real Gradle builds
```

The full product of all six options is 324 builds, which nobody will ever run. `npm run
matrix` uses **all-pairs coverage** instead: 13 projects in which every pair of option values
appears together at least once. That is where interaction bugs live, at 4% of the cost.
`node test/matrix.mjs --full` still does all 324 if you want it.

The matrix **fails on Kotlin warnings as well as errors** — a deprecation warning today is a
compile error two releases from now. It retries a failed build once, so an environmental
flake is labelled rather than mistaken for a real break.

Last pairwise run: **13/13 built with zero warnings** against AGP 9.3.1 / Kotlin 2.4.10 /
compileSdk 37 (22 August 2026).

Refreshing the vendored data:

```bash
npm run pin         # snapshot today's versions as the offline fallback
npm run api-levels  # Android API levels from endoflife.date
npm run logos       # library logos
npm run fonts       # Roboto, for the GUI
```

## Licence

MIT — see [LICENSE](LICENSE). Third-party marks and vendored data are credited in
[NOTICE.md](NOTICE.md). Not affiliated with or endorsed by Google.
