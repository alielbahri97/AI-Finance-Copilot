package com.ballastmoney.android.core.domain

import kotlinx.coroutines.flow.Flow

/**
 * The two things the HTTP layer needs from the session, expressed as narrow
 * interfaces so that `data/remote` does not depend on Supabase and the auth
 * implementation does not depend on Ktor.
 *
 * Keeping them separate from [SessionRepository] is deliberate: that interface
 * is about the *bootstrap payload*, which is fetched over HTTP and therefore
 * cannot be what HTTP depends on without a cycle.
 */

/** Supplies, and can renew, the Supabase access token. */
interface AccessTokenProvider {

    /**
     * The current access token, or null when nobody is signed in. Must not
     * block on the network in the common case — a cached token is expected.
     */
    suspend fun currentAccessToken(): String?

    /**
     * Forces a refresh and returns the new access token, or null if the
     * session could not be renewed (which means the user has to sign in).
     *
     * Called once per `401`. Implementations must collapse concurrent callers
     * onto a single refresh rather than firing one per in-flight request.
     */
    suspend fun refreshAccessToken(): String?
}

/**
 * Supplies the `X-Ballast-Workspace` value.
 *
 * Null is a valid answer and means "no opinion": the server then falls back to
 * the cookie, and then to the user's default workspace. The header is only ever
 * a hint — membership is re-verified server-side on every request.
 */
interface WorkspaceSelection {
    val selectedWorkspaceId: Flow<String?>

    suspend fun currentWorkspaceId(): String?

    suspend fun select(workspaceId: String?)
}

/** Whether anyone is signed in, for the shell to route on. */
interface AuthStateSource {
    val isSignedIn: Flow<Boolean>
}
