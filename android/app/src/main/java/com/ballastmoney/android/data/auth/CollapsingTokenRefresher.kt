package com.ballastmoney.android.data.auth

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Turns any number of simultaneous "this token is stale" calls into one refresh.
 *
 * The situation it exists for: the dashboard fires four requests at once, the
 * access token has just expired, and all four come back `401`. Each one asks
 * for a refresh. Without collapsing, four refresh calls race — Supabase rotates
 * the refresh token on every use, so the first to land invalidates the token
 * the other three are holding, and the user is signed out by their own app
 * loading a screen.
 *
 * The rule is a mutex plus a re-read. A caller notes the token it found stale
 * *before* taking the lock; once inside, it looks again, and if the token has
 * changed since then somebody else already did the work and it simply returns
 * the new one. Only the first caller through actually refreshes.
 *
 * Split out from [SupabaseAuthGateway] as two function parameters rather than
 * written inline so the rule can be tested on the JVM: proving that four
 * concurrent callers cause one refresh needs no Supabase project, no Android
 * framework and no network.
 *
 * A shared `Deferred` was the alternative. It behaves the same for the case
 * above but has a sharper failure mode — a caller that arrives just as the
 * previous refresh completes joins a `Deferred` that is already resolved and
 * gets a result from a moment ago, whereas the re-read always answers with what
 * is true now.
 */
class CollapsingTokenRefresher(
    private val readToken: suspend () -> String?,
    private val performRefresh: suspend () -> Unit,
) {

    private val mutex = Mutex()

    /**
     * The renewed access token, or null when the session could not be renewed —
     * which means the refresh token is dead too and the user has to sign in.
     *
     * [performRefresh] is allowed to throw; a failed refresh is an ordinary
     * outcome (offline, revoked session) and callers get null rather than an
     * exception.
     */
    suspend fun refresh(): String? {
        val stale = readToken()
        return mutex.withLock {
            val current = readToken()
            if (current != null && current != stale) {
                return@withLock current
            }
            runCatching { performRefresh() }
            readToken()
        }
    }
}
