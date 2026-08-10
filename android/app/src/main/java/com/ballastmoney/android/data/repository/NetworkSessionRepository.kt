package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.WorkspaceSelection
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.data.auth.AuthOutcome
import com.ballastmoney.android.data.auth.AuthRepository
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.BallastApiError
import com.ballastmoney.android.data.remote.apiCall
import com.ballastmoney.android.data.remote.mapper.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The launch payload, backed by `GET /api/session/bootstrap`.
 *
 * ### Why this cache is in memory and not in Room
 *
 * The transactions repository caches to the database because its data is large,
 * pageable and worth reading offline. The session is none of those. It is one
 * small object, every field of it is an authorization decision — permissions,
 * edition, plan limits — and a stale authorization decision is the one kind of
 * stale data that is actively harmful. Persisting it would mean a member removed
 * from a workspace, or downgraded to a viewer, keeping the old surface until the
 * next successful call. So it lives in a [MutableStateFlow] for the life of the
 * process and a cold start re-bootstraps, which is one request the app cannot draw
 * anything before anyway.
 *
 * The server still enforces every one of those decisions on every request. This
 * cache decides what to *draw*, never what is *allowed*.
 */
@Singleton
class NetworkSessionRepository @Inject constructor(
    private val api: BallastApi,
    private val workspaceSelection: WorkspaceSelection,
    private val auth: AuthRepository,
) : SessionRepository {

    private val cached = MutableStateFlow<SessionBootstrap?>(null)

    override val session: Flow<SessionBootstrap?> = cached.asStateFlow()

    override suspend fun refresh(): Result<Unit> = apiCall {
        // A null selection lets the server choose: on a first launch the client
        // does not yet know which workspaces exist, and the server's default
        // membership is a better answer than a guess.
        val bootstrap = api
            .bootstrap(workspaceSelection.currentWorkspaceId())
            .getOrThrow()
            .toDomain()
        cached.value = bootstrap
        // Record what the server actually chose, so every later request names it
        // explicitly rather than re-deriving the default. Without this the
        // workspace header stays absent until the user switches by hand.
        workspaceSelection.select(bootstrap.currentWorkspace.id)
    }

    /**
     * Switches workspace.
     *
     * The selection is written first and the bootstrap follows, because the request
     * has to carry the new workspace to come back describing it. A failed bootstrap
     * rolls the selection back: leaving it pointing at a workspace the app never
     * loaded would send every later request somewhere the interface is not.
     */
    override suspend fun selectWorkspace(workspaceId: String): Result<Unit> {
        val previous = workspaceSelection.currentWorkspaceId()
        workspaceSelection.select(workspaceId)
        return refresh().onFailure { workspaceSelection.select(previous) }
    }

    /**
     * Ends the session.
     *
     * The local state is cleared whatever Supabase said, which is the important
     * part: a user who taps "sign out" must not still be looking at their balances
     * because a request failed. supabase-kt clears its own stored session before it
     * calls the network for the same reason, so a failure here means "the server
     * was not told", not "this device is still signed in".
     *
     * The workspace selection goes too. Keeping it would send the previous user's
     * workspace id on the next sign-in and briefly title the screen with a
     * workspace the new user may not even be a member of.
     */
    override suspend fun signOut(): Result<Unit> {
        val outcome = auth.signOut()
        cached.value = null
        workspaceSelection.select(null)
        return when (outcome) {
            AuthOutcome.Success, AuthOutcome.Cancelled -> Result.success(Unit)
            is AuthOutcome.Failure -> Result.failure(BallastApiError.Network(outcome.message))
        }
    }
}
