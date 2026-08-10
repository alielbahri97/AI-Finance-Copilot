# Ballast for Android

The native Android client for Ballast, living in the same repository as the web
app so an API change and the client change that needs it can ship in one pull
request.

The JSON API this client consumes now exists — see `MOBILE_API.md` at the
repository root, which is the frozen wire contract — and the network layer,
Supabase authentication and the GoCardless bank flow are written against it.

> **Nothing in here has been compiled, and on this machine it cannot be.**
> The blocker is not a missing download but a corporate proxy that permits
> GitHub and an internal Artifactory mirror and refuses everything else,
> including `dl.google.com` and `maven.google.com`. Android Gradle Plugin,
> every `androidx` artifact, the Compose BOM and the Android SDK platform and
> build-tools all live only on Google's Maven repository, and the internal
> Artifactory has no mirror of it. Gradle's own distribution site is blocked
> too. See [Toolchain](#toolchain) for what was established, what was ruled
> out, and what a machine with ordinary network access needs to run.

## Layout

```
android/
  settings.gradle.kts          modules and repositories
  build.gradle.kts             plugin versions, applied per module
  gradle/libs.versions.toml    the single source of dependency versions
  app/                         the application
  baselineprofile/             Baseline Profile generator (com.android.test)
```

Inside `app/src/main/java/com/ballastmoney/android`:

| Package | What lives there |
| --- | --- |
| `core/model` | API payloads, edition and permission rules, money and date serializers |
| `core/domain` | Repository interfaces — the contract the network layer must satisfy |
| `core/common` | `MoneyFormatter`, shared formatting |
| `data/fake` | The in-memory dataset and the fake repositories |
| `data/local` | Room entities, DAOs, the outbox table |
| `data/preferences` | DataStore-backed settings and session-lock state |
| `data/remote` | Ktor client configuration and the endpoint list |
| `designsystem` | Theme tokens, brand mark, primitives |
| `navigation` | Type-safe routes and the navigation table |
| `session` | Session lock and biometric unlock |
| `ui/*` | One package per screen: state, ViewModel, composables |
| `di` | Hilt modules |

One module rather than several. A multi-module split pays for itself when build
times hurt or when several teams need enforced boundaries; here it would add
Gradle configuration and a lot of `api`/`implementation` bookkeeping to a codebase
one person can hold in their head. The package structure is the boundary, and
`core/domain` depending on nothing above it is the rule that matters.

## Toolchain

### What is installed here, and what could not be

A JDK **is** now installed and working: Temurin 17.0.20, unpacked from the
Adoptium GitHub release into `%LOCALAPPDATA%\ballast-toolchain\jdk`. It had to
come from GitHub as a plain zip because `winget install` fails with exit code
1625 — MSI installation is forbidden by machine policy — and because the
Adoptium API host is not reachable either.

Everything else was ruled out, and it is worth writing down so nobody repeats
the search:

| Needed from | Host | Result |
| --- | --- | --- |
| AGP, all `androidx`, Compose BOM | `dl.google.com`, `maven.google.com` | 403 at the proxy |
| Android SDK platform + build-tools | `dl.google.com` | 403 at the proxy |
| Gradle 8.14.3 distribution | `services.gradle.org` | 403 at the proxy |
| Maven Central directly | `repo1.maven.org` | 403 at the proxy |
| Maven Central via internal mirror | Artifactory `apache-maven-remote` | **works** |
| Google's Maven via internal mirror | — | **does not exist**; no Google or Android remote is configured, and a `gavc` search across all 117 repositories finds no `androidx` or `com.android.tools.build` artifact at all |

So the build is blocked on two independent things — the Android Gradle Plugin
and the SDK — that are only published on a host this network refuses. That is
an environment limitation, not a repository one. On a machine with ordinary
internet access the steps below are unchanged and should work.

### On a machine that can reach Google

1. **JDK 17** (AGP 8.13 needs 17 or newer; 17 is what the build targets).

   ```powershell
   winget install --id EclipseAdoptium.Temurin.17.JDK
   ```

2. **Android SDK**, command-line tools only — far smaller than Android Studio
   and sufficient to build:

   ```powershell
   # unzip commandlinetools-win-*.zip to %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   sdkmanager --licenses
   ```

3. **Gradle 8.14.3**, once, to generate the wrapper:

   ```powershell
   winget install --id Gradle.Gradle
   cd android
   gradle wrapper --gradle-version 8.14.3
   ```

   Then delete the `gradle/wrapper/gradle-wrapper.jar`, `gradlew` and
   `gradlew.bat` lines from `android/.gitignore` and **commit the wrapper**. A
   repository without a working wrapper is a repository nobody else can build.
   It is still ignored here only because Gradle could not be installed to
   generate it, and a binary jar is not something to invent.

4. **`local.properties`** pointing at the SDK, if the environment variable is
   not set. It is gitignored and must stay that way — it is machine-specific:

   ```properties
   sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
   ```

### Verifying

```powershell
cd android
.\gradlew --version                     # wrapper and JDK are wired up
.\gradlew :app:compileDebugKotlin       # the code compiles
.\gradlew :app:testDebugUnitTest        # JUnit 5 unit tests
.\gradlew :app:lintDebug                # Android lint
.\gradlew :app:assembleDebug            # an installable APK
.\gradlew :app:connectedDebugAndroidTest   # Compose UI tests, needs a device
```

Expect the first run to download roughly a gigabyte of dependencies, and expect
real failures: **none of this has ever been through a compiler.**

Half of `libs.versions.toml` has at least been checked against a real resolver
— the Maven Central mirror above confirmed that the pinned Kotlin, Ktor,
coroutines, serialization, Hilt, JUnit 5, Turbine, Coil, Vico and supabase-kt
versions all genuinely exist as published artifacts. The other half, everything
on Google's Maven (`agp`, `ksp`, `composeBom`, every `androidx*`), remains as
it was pinned from release notes and is the most likely first failure.

### Supabase credentials

The app needs the project URL and anon key. `app/build.gradle.kts` reads them
from `android/secrets.properties`, which is **gitignored and must never be
committed**:

```properties
supabase.url=https://<project-ref>.supabase.co
supabase.anonKey=<your-anon-key>
```

Or set `BALLAST_SUPABASE_URL` and `BALLAST_SUPABASE_ANON_KEY` in the
environment, which is what CI should do. The names mirror the web app's
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` minus the prefix
that only means something to Next.js.

Both default to an empty string, so a checkout with no credentials still
*builds*. It will not sign in: the auth layer reports a specific, actionable
error naming this file rather than letting Supabase fail with something
cryptic.

### Stopgap checks

Two PowerShell scripts in `tools/` stand in for the compiler that still cannot
be run here. Both exit non-zero on a finding and both are text searches, not
type checkers.

```powershell
powershell -File tools\check-imports.ps1   # imports of Ballast symbols nothing declares
powershell -File tools\check-args.ps1      # named arguments the callee does not declare
```

The second is the useful one: it caught three real call-site mismatches between
files written against slightly different ideas of the same component's API. It
knows nothing about types, arity or overloads, so a clean run is a weak signal,
not a green build.

**Delete both the moment `:app:compileDebugKotlin` passes.** They were meant to
be deleted in this change and are still here for exactly one reason: the real
compiler could not be obtained, so they are still the only check that exists.

### Fonts

Inter and JetBrains Mono now ship for real, downloaded from the upstream GitHub
releases (Inter 4.1, JetBrains Mono 2.304). `res/font` holds the four Inter
weights the type scale actually names — Regular, Medium, SemiBold, Bold — and
JetBrains Mono Regular and Medium; static faces rather than the variable font,
for the reason given in `designsystem/theme/Type.kt`. Both are SIL Open Font
License 1.1 and both licences ship inside the APK under `assets/licenses/`.

## Data

The four interfaces in `core/domain/Repositories.kt` are now backed by real
Ktor implementations in `data/repository`, and `BuildConfig.USE_FAKE_DATA` is
false in both build types. The interfaces are shaped so that:

- reads are cold `Flow`s that emit the cache and keep emitting as it changes; an
  empty cache emits `null` or an empty list, never an exception;
- writes and refreshes are `suspend` functions returning `Result`, so the caller
  decides between a snackbar, a retry and a full error screen.

Nothing in `ui/` had to change, which was the point of building the fakes behind
interfaces in the first place.

**The fakes are still here and still work.** `data/fake` holds a dataset
generated from a fixed seed, so the numbers are the same on every run and a
screenshot test can assert against them, and a permanent "Sample data" line sits
under the top bar while the flag is true. Flip `USE_FAKE_DATA` to true in
`app/build.gradle.kts` to browse the app with no backend at all; the three
Compose UI tests assert against that dataset and need it.

### How the wire contract is kept at arm's length

`data/remote/dto` mirrors the JSON exactly and `data/remote/mapper` converts it
to the domain model. The two are separate because the domain types were designed
for the screens, before this API existed, and they disagree with the wire in a
dozen small ways: the bootstrap payload nests permissions under `membership`,
the dashboard sends a category *name* where the transactions list sends an
object, percentages arrive as fractions and are stored as whole numbers. One
mapper absorbs all of that, so a wire change is one edit rather than thirty.

Where the API does not carry something the domain model has — the
Personal-edition dashboard blocks, the unread-notification count — the mapper
fills in the empty value and says so in a comment. Those cards render their
empty state rather than being handed invented figures.

### Paging

Transactions page through a Room `RemoteMediator`: the network writes into the
database and the list is read back out of it, so Room is the single source of
truth and the list survives rotation, process death and going offline. The
`transaction_pages` table records "for query K, position N is transaction X",
which is what lets the client replay the server's exact ordering — two rows with
the same date fall back to `createdAt`, which the API does not expose, so the
client cannot reproduce the order itself.

One detail from the contract that the mediator has to respect: the `page` in the
response is *the page actually served*, so asking for page 40 of a three-page
set returns page 3 rather than an empty list. The mediator compares what it
asked for with what it got and stops; without that it would page forever against
a clamped tail.

## Money

Money is `java.math.BigDecimal`, serialized as a decimal **string**, everywhere.
There is no `Double` anywhere in the money path, and `SerializersTest` fails if one
appears. Amounts are stored in Room as minor units in a `Long`. Timestamps are ISO
8601 with an explicit offset and are parsed to `java.time.Instant` — the app never
guesses a timezone.

## Session lock

The app locks after it has been in the background longer than the user's threshold
(45 seconds by default; the web app's 10 seconds is unusable on a phone). The
elapsed time comes from `SystemClock.elapsedRealtime`, so changing the device clock
does not defeat it, and the locked flag is persisted so the lock survives process
death. `FLAG_SECURE` keeps balances out of the recent-apps thumbnail in release
builds; it is off in debug so screenshots and UI tests still work.
