package com.ballastmoney.android.data.auth

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds the one [SupabaseClient], or explains why it could not.
 *
 * ### Auth only
 *
 * Only the `Auth` plugin is installed, and `postgrest-kt` is deliberately not a
 * dependency of this app. Every authorization rule Ballast obeys — which
 * workspace a row belongs to, the member's role, the permission set, the
 * edition's feature list and the plan's limits — is enforced by the Next.js API
 * in `requireWorkspace()` and friends. A client that talked to PostgREST
 * directly would be authenticated but not authorized: it would bypass all of
 * that and be limited only by whatever row-level security happens to be
 * configured, which is a different and much weaker rule set. Supabase is the
 * identity provider here and nothing else; data comes from the API, over HTTP,
 * with the access token attached.
 *
 * ### Why it does not reuse the app's Ktor client
 *
 * supabase-kt takes an `HttpClientEngine`, and the app's `HttpClient` in
 * `di/CoreModule.kt` does expose one. Sharing it would nevertheless create a
 * cycle in the dependency graph the moment `BallastAuth` is installed on that
 * client: the plugin needs an `AccessTokenProvider`, which is
 * [SupabaseAuthGateway], which needs this provider, which would need the
 * `HttpClient`. Letting supabase-kt pick up the OkHttp engine from the
 * classpath keeps the two graphs separate. The cost is a second OkHttp
 * dispatcher and connection pool, which is a handful of idle threads; the cost
 * of the cycle would be a build that does not compile.
 *
 * ### Construction is lazy and cannot throw
 *
 * The client is built on first use, not when Hilt constructs the singleton, and
 * a failure yields null rather than an exception. Auth is needed by the app
 * shell on the very first frame, and a provider that throws there takes the
 * process down before anything can render the reason.
 */
@Singleton
class SupabaseClientProvider @Inject constructor(
    private val sessionStorage: EncryptedSessionStorage,
) {

    /** What the build-time credentials look like. Read by the login screen. */
    val configuration: SupabaseConfiguration = SupabaseConfig.current

    /** Null when the app is configured; otherwise the text to put on screen. */
    val configurationProblem: String?
        get() = (configuration as? SupabaseConfiguration.Missing)?.message

    private val lazyClient: SupabaseClient? by lazy { build() }

    /** Null when there are no credentials, or the client could not be built. */
    val client: SupabaseClient?
        get() = lazyClient

    /** Convenience for the two classes that only ever want the plugin. */
    val auth: Auth?
        get() = lazyClient?.auth

    private fun build(): SupabaseClient? {
        val ready = configuration as? SupabaseConfiguration.Ready ?: return null
        return runCatching {
            createSupabaseClient(supabaseUrl = ready.url, supabaseKey = ready.anonKey) {
                install(Auth) {
                    // Refresh tokens do not belong in plain SharedPreferences,
                    // which is what the SDK would use otherwise.
                    sessionManager = sessionStorage
                    // Makes the deep link the default redirect for emailed
                    // links; the calls that care still pass one explicitly so
                    // the destination is visible at the call site.
                    scheme = AuthDeepLink.SCHEME
                    host = AuthDeepLink.HOST
                    autoLoadFromStorage = true
                    autoSaveToStorage = true
                    alwaysAutoRefresh = true
                    // flowType is left at supabase-kt's IMPLICIT default. PKCE
                    // is the stronger flow, but it binds a reset link to the
                    // device that asked for it, because the code verifier lives
                    // in that device's storage. People ask for a reset on a
                    // laptop and open the email on a phone; under PKCE that
                    // fails with a code-verifier error they cannot act on.
                    // AuthCallbackParser reads both shapes, so switching this
                    // later needs no change here beyond the line itself.
                }
            }
        }.getOrNull()
    }
}
