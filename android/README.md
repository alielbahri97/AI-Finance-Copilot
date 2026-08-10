# Ballast for Android

The native Android client for Ballast, living in the same repository as the web
app so an API change and the client change that needs it can ship in one pull
request.

This is the foundation only: project and build setup, the design system, the
navigation shell, and the dashboard, transactions and banks screens rendered from
in-memory fixtures. There is no real authentication, no billing, and no network
layer yet — the JSON API is being built in parallel.

> **Nothing in here has been compiled.** The machine this was written on has no
> JDK, no Gradle and no Android SDK. See [Toolchain](#toolchain) for exactly what
> to install and which commands verify the build.

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

Nothing needed to build this is currently installed. Required:

1. **JDK 17** (AGP 8.13 needs 17 or newer; 17 is what the build targets).

   ```powershell
   winget install --id EclipseAdoptium.Temurin.17.JDK
   ```

2. **Android SDK**, platform 36 and build tools. Easiest through Android Studio;
   otherwise the command-line tools:

   ```powershell
   winget install --id Google.AndroidStudio
   # or, command-line tools only, unzipped to %LOCALAPPDATA%\Android\Sdk
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```

3. **Gradle 8.14.3**, once, to generate the wrapper — or let Android Studio do it
   on first sync.

   ```powershell
   winget install --id Gradle.Gradle
   cd android
   gradle wrapper --gradle-version 8.14.3
   ```

   After the wrapper exists, delete the `gradle/wrapper/gradle-wrapper.jar`,
   `gradlew` and `gradlew.bat` lines from `android/.gitignore` and commit them.
   A committed wrapper is the norm — it is what makes a build reproducible on a
   machine that has no Gradle at all. They are ignored today only because a binary
   jar could not be produced here.

4. **`local.properties`** pointing at the SDK, if the environment variable is not
   set:

   ```properties
   sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
   ```

### Verifying

```powershell
cd android
.\gradlew --version                     # wrapper and JDK are wired up
.\gradlew :app:compileDebugKotlin       # the code compiles
.\gradlew :app:assembleDebug            # an installable APK
.\gradlew :app:testDebugUnitTest        # JUnit 5 unit tests
.\gradlew :app:lintDebug                # Android lint
.\gradlew :app:connectedDebugAndroidTest   # Compose UI tests, needs a device
```

Expect the first run to download roughly a gigabyte of dependencies. If a version
in `libs.versions.toml` fails to resolve, that is the most likely first failure —
every version was pinned from release notes rather than verified against a real
resolver.

## Data, today and later

Every screen reads from `data/fake`. The dataset is generated from a fixed seed, so
the numbers are the same on every run and a screenshot test can assert against
them. A permanent "Sample data" line sits under the top bar while
`BuildConfig.USE_FAKE_DATA` is true, because a screen of convincing invented
balances should say that it is invented.

Swapping in the real API means writing implementations of the four interfaces in
`core/domain/Repositories.kt` and changing the bindings in `di/RepositoryModule.kt`
— one line each. Nothing in `ui/` changes. The interfaces are shaped so that:

- reads are cold `Flow`s that emit the cache and keep emitting as it changes; an
  empty cache emits `null` or an empty list, never an exception;
- writes and refreshes are `suspend` functions returning `Result`, so the caller
  decides between a snackbar, a retry and a full error screen.

`data/remote` already holds the configured Ktor client, the JSON configuration and
the endpoint and query-parameter names.

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
