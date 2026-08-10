package com.ballastmoney.android.data.auth

import java.net.URLDecoder

/**
 * The custom scheme Supabase redirects back to after an emailed link.
 *
 * A custom scheme rather than an App Link because an App Link needs a verified
 * `assetlinks.json` served from `app.ballastmoney.com`, which in turn needs the
 * Play signing certificate fingerprint. Neither is available here, and an
 * unverified App Link falls back to a disambiguation dialog, which is worse
 * than a scheme that simply works. The trade-off is that any app may claim
 * `ballast://` — which is why nothing sensitive is ever *sent* to this URL, only
 * received from Supabase, and why the tokens that arrive are exchanged
 * immediately rather than stored.
 *
 * Both values must also be added to **Authentication → URL Configuration →
 * Redirect URLs** in the Supabase dashboard, otherwise Supabase silently
 * rewrites the redirect to the site URL and the link opens a browser instead of
 * the app.
 */
object AuthDeepLink {

    const val SCHEME = "ballast"
    const val HOST = "auth"

    /** Where `resetPasswordForEmail` sends the user back to. */
    const val RESET_PASSWORD = "$SCHEME://$HOST/reset-password"

    /** Where the sign-up confirmation email sends the user back to. */
    const val EMAIL_CONFIRMED = "$SCHEME://$HOST/confirmed"
}

/**
 * A parsed `ballast://auth/...` callback.
 *
 * Both of Supabase's flows are represented because the project's flow type is a
 * server-side and client-side setting that can change without this client being
 * rebuilt: the implicit flow returns tokens in the URL *fragment*, PKCE returns
 * a `code` in the *query*. Reading both costs a few lines and removes a whole
 * class of "it stopped working after someone flipped a setting".
 */
data class AuthCallbackLink(
    /** True for a password-recovery link, which must not sign the user straight in. */
    val isRecovery: Boolean,
    /** PKCE: exchange for a session. */
    val code: String? = null,
    /** Implicit flow. */
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresIn: Long? = null,
    val tokenType: String? = null,
    /** Supabase reports expired and already-used links this way. */
    val errorDescription: String? = null,
) {
    /** Whether there is anything here to turn into a session. */
    val hasCredentials: Boolean
        get() = code != null || (accessToken != null && refreshToken != null)
}

/**
 * Turns a deep-link URI into an [AuthCallbackLink].
 *
 * Hand-rolled rather than going through `android.net.Uri` for two reasons: it
 * keeps the parsing testable on the JVM, and `Uri.getQueryParameter` does not
 * look at the fragment, which is exactly where the implicit flow puts the
 * tokens. Anything that is not a Ballast auth callback returns null.
 */
object AuthCallbackParser {

    fun parse(uri: String?): AuthCallbackLink? {
        val prefix = "${AuthDeepLink.SCHEME}://${AuthDeepLink.HOST}"
        if (uri == null || !uri.startsWith(prefix)) return null

        val remainder = uri.removePrefix(prefix)
        val fragmentAt = remainder.indexOf('#')
        val beforeFragment = if (fragmentAt >= 0) remainder.substring(0, fragmentAt) else remainder
        val fragment = if (fragmentAt >= 0) remainder.substring(fragmentAt + 1) else ""

        val queryAt = beforeFragment.indexOf('?')
        val path = if (queryAt >= 0) beforeFragment.substring(0, queryAt) else beforeFragment
        val query = if (queryAt >= 0) beforeFragment.substring(queryAt + 1) else ""

        // Fragment last so that, in the unlikely event both carry the same key,
        // the flow that actually produced the tokens wins.
        val parameters = parameters(query) + parameters(fragment)

        return AuthCallbackLink(
            isRecovery = parameters["type"] == "recovery" || path.startsWith("/reset-password"),
            code = parameters["code"],
            accessToken = parameters["access_token"],
            refreshToken = parameters["refresh_token"],
            expiresIn = parameters["expires_in"]?.toLongOrNull(),
            tokenType = parameters["token_type"],
            errorDescription = parameters["error_description"] ?: parameters["error"],
        )
    }

    private fun parameters(raw: String): Map<String, String> {
        if (raw.isEmpty()) return emptyMap()
        return raw.split('&')
            .mapNotNull { pair ->
                val separator = pair.indexOf('=')
                if (separator <= 0) return@mapNotNull null
                val key = decode(pair.substring(0, separator))
                val value = decode(pair.substring(separator + 1))
                if (value.isEmpty()) null else key to value
            }
            .toMap()
    }

    private fun decode(value: String): String =
        runCatching { URLDecoder.decode(value, Charsets.UTF_8.name()) }.getOrDefault(value)
}
