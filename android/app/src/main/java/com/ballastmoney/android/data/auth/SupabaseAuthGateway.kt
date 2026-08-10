package com.ballastmoney.android.data.auth

import com.ballastmoney.android.core.domain.AccessTokenProvider
import com.ballastmoney.android.core.domain.AuthStateSource
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.mapNotNull
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The single adapter between Supabase Auth and the rest of the app.
 *
 * It satisfies the two narrow interfaces in `core/domain/AuthGateway.kt` and
 * nothing else depends on supabase-kt: the HTTP layer sees an
 * [AccessTokenProvider], the shell sees an [AuthStateSource], and neither knows
 * which identity provider is behind them.
 *
 * ### The session lock does not touch any of this
 *
 * Locking the app is a **user-interface gate**, not a sign-out. It flips one
 * boolean in DataStore, the shell renders the lock screen instead of the
 * navigation graph, and this class carries on exactly as before: the Supabase
 * session stays in encrypted storage, auto-refresh keeps running so the token
 * is still valid when the user comes back, and [isSignedIn] stays true. That is
 * the whole point — a lock the user clears with a fingerprint in half a second
 * would be pointless if it cost them a password re-entry, and it is what makes
 * a 45-second threshold acceptable. Signing out is a separate, explicit action
 * on the lock screen, and it is the only thing that clears the session.
 */
@Singleton
class SupabaseAuthGateway @Inject constructor(
    private val clientProvider: SupabaseClientProvider,
) : AccessTokenProvider, AuthStateSource {

    private val refresher = CollapsingTokenRefresher(
        readToken = { clientProvider.auth?.currentAccessTokenOrNull() },
        performRefresh = { clientProvider.auth?.refreshCurrentSession() },
    )

    /**
     * Reads the token supabase-kt already holds in memory. No network, which is
     * what the interface asks for: this runs on every outbound request.
     */
    override suspend fun currentAccessToken(): String? =
        clientProvider.auth?.currentAccessTokenOrNull()

    override suspend fun refreshAccessToken(): String? = refresher.refresh()

    /**
     * Collected by the shell to decide between the login screen and the app.
     *
     * Built with `flow { }` so the client is created on first collection rather
     * than when Hilt builds the singleton — an unconfigured build must be able
     * to reach the login screen and render the configuration error there.
     */
    override val isSignedIn: Flow<Boolean> = flow {
        val auth = clientProvider.auth
        if (auth == null) {
            emit(false)
            return@flow
        }
        emitAll(auth.sessionStatus.mapNotNull { it.signedIn() })
    }.distinctUntilChanged()

    /**
     * Null while the answer is not known yet, so the shell can hold a splash
     * rather than flashing the login screen at someone who is signed in. The
     * session is read from encrypted storage asynchronously on start, and that
     * read is fast but not instant.
     *
     * A refresh failure counts as signed in. supabase-kt keeps the session in
     * storage and retries in that state — it means "the network is unhappy",
     * not "this account is gone" — and treating it as signed out would throw a
     * user onto the login screen every time a train enters a tunnel.
     */
    private fun SessionStatus.signedIn(): Boolean? = when (this) {
        is SessionStatus.Authenticated -> true
        is SessionStatus.RefreshFailure -> true
        is SessionStatus.NotAuthenticated -> false
        SessionStatus.Initializing -> null
    }
}
