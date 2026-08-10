package com.ballastmoney.android.data.auth

import com.ballastmoney.android.BuildConfig

/**
 * Whether this build has usable Supabase credentials.
 *
 * A checkout with no credentials still compiles and still runs — `build.gradle.kts`
 * defaults both `BuildConfig` fields to the empty string on purpose — so the
 * absence has to be caught here rather than by letting supabase-kt fail later.
 * Handing an empty URL to `createSupabaseClient` produces an
 * `IllegalArgumentException` about a malformed host at the moment the first
 * screen tries to sign in, which tells the person running the app nothing about
 * what to do next.
 */
sealed interface SupabaseConfiguration {

    /** Both values are present. Nothing here proves they are *correct*. */
    data class Ready(val url: String, val anonKey: String) : SupabaseConfiguration

    /**
     * At least one value is blank. [message] names the file, the keys and the
     * environment variables, so it can be rendered verbatim on the login screen.
     */
    data class Missing(val message: String) : SupabaseConfiguration
}

/**
 * Reads and validates [BuildConfig.SUPABASE_URL] and
 * [BuildConfig.SUPABASE_ANON_KEY].
 *
 * The checks are deliberately shallow — present, and shaped like a URL. Proving
 * the project exists means a network round trip, and a configuration check that
 * needs the network is a configuration check that fails on a train.
 */
object SupabaseConfig {

    /** Evaluated once, lazily, so no work happens during class loading. */
    val current: SupabaseConfiguration by lazy {
        inspect(url = BuildConfig.SUPABASE_URL, anonKey = BuildConfig.SUPABASE_ANON_KEY)
    }

    /** Null when the app is configured. Otherwise the text the user must act on. */
    val problem: String?
        get() = (current as? SupabaseConfiguration.Missing)?.message

    /**
     * Pure, so the wording can be exercised without `BuildConfig`.
     *
     * A URL that is present but does not start with a scheme is treated as
     * missing rather than passed through: supabase-kt accepts a bare host, but
     * someone who has pasted `https://id.supabase.co/auth/v1` — a mistake the
     * SDK rejects with its own message — is better served by being told the
     * shape it wants here.
     */
    fun inspect(url: String, anonKey: String): SupabaseConfiguration {
        val trimmedUrl = url.trim()
        val trimmedKey = anonKey.trim()

        val missing = buildList {
            if (trimmedUrl.isEmpty()) add(URL_KEY)
            if (trimmedKey.isEmpty()) add(ANON_KEY_KEY)
        }
        if (missing.isNotEmpty()) {
            return SupabaseConfiguration.Missing(missingMessage(missing))
        }
        if (trimmedUrl.contains("/auth/v1")) {
            return SupabaseConfiguration.Missing(MODULE_IN_URL_MESSAGE)
        }
        return SupabaseConfiguration.Ready(url = trimmedUrl, anonKey = trimmedKey)
    }

    private fun missingMessage(missingKeys: List<String>): String {
        val keys = missingKeys.joinToString(separator = " and ")
        val plural = if (missingKeys.size > 1) "values are" else "value is"
        return "Ballast has no Supabase credentials, so signing in is not possible in this " +
            "build. The $keys $plural empty.\n\n" +
            "Create $SECRETS_FILE (it is gitignored and never committed) with:\n" +
            "  $URL_KEY=https://YOUR-PROJECT.supabase.co\n" +
            "  $ANON_KEY_KEY=YOUR-PUBLISHABLE-ANON-KEY\n\n" +
            "Or set $URL_ENV and $ANON_KEY_ENV in the environment before building. " +
            "Then rebuild and reinstall — these are compiled into the APK, so a " +
            "restart alone will not pick them up."
    }

    private const val SECRETS_FILE = "android/secrets.properties"
    private const val URL_KEY = "supabase.url"
    private const val ANON_KEY_KEY = "supabase.anonKey"
    private const val URL_ENV = "BALLAST_SUPABASE_URL"
    private const val ANON_KEY_ENV = "BALLAST_SUPABASE_ANON_KEY"

    private const val MODULE_IN_URL_MESSAGE =
        "The Supabase URL in $SECRETS_FILE points at a module rather than the project. " +
            "Use just the project origin — https://YOUR-PROJECT.supabase.co — with no " +
            "/auth/v1 suffix; the SDK appends the module itself."
}
