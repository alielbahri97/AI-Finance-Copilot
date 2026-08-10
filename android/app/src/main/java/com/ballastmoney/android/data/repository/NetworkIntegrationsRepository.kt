package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.domain.IntegrationsRepository
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.SyncOutcome
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.BallastApiError
import com.ballastmoney.android.data.remote.apiCall
import com.ballastmoney.android.data.remote.mapper.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The provider grid and its connections, backed by `GET /api/integrations`.
 *
 * ### `locked` is not an error
 *
 * The endpoint answers `200` with `locked: true` when the plan does not include
 * integrations, and the mapper turns that into an `UPGRADE_REQUIRED` reason on the
 * overview rather than into a failure. The grid then renders behind an upgrade
 * prompt, which is what the web app does and what a user needs to see to decide
 * whether to pay. A `402` here would have replaced a persuasive screen with an
 * error one. The plan is enforced where it matters: on connect and on sync.
 *
 * ### Why the write methods look up a provider first
 *
 * `sync`, `setIncludeInTotals` and `disconnect` are all addressed as
 * `/api/integrations/{provider}/...`, but the repository interface identifies a
 * connection by id alone — which is the right shape for the caller, since a
 * connection row in the interface knows nothing about URL structure. The provider
 * is therefore resolved from the cached overview. That makes a successful refresh a
 * precondition for a write, which it already is in practice: these actions are only
 * reachable from a rendered connection.
 */
@Singleton
class NetworkIntegrationsRepository @Inject constructor(
    private val api: BallastApi,
) : IntegrationsRepository {

    private val cached = MutableStateFlow<Map<String, IntegrationsOverview>>(emptyMap())

    override fun overview(workspaceId: String): Flow<IntegrationsOverview?> =
        cached.map { it[workspaceId] }

    override suspend fun refresh(workspaceId: String): Result<Unit> = apiCall {
        reload(workspaceId)
    }

    override suspend fun sync(workspaceId: String, connectionId: String): Result<SyncOutcome> =
        apiCall {
            val connection = requireConnection(workspaceId, connectionId)
            val result = api
                .sync(workspaceId, connection.providerId, connectionId)
                .getOrThrow()
            // Balances, last-sync time and any new error state have all changed, and
            // the sync response carries none of them, so the grid is re-read.
            reload(workspaceId)
            // The title comes from the connection the user tapped rather than from
            // the response, which does not carry one: the confirmation says "Monzo
            // synced", and this is where that name is.
            SyncOutcome(connectionTitle = connection.title, stats = result.stats)
        }

    override suspend fun setIncludeInTotals(
        workspaceId: String,
        connectionId: String,
        accountId: String,
        includeInTotals: Boolean,
    ): Result<Unit> = apiCall {
        val connection = requireConnection(workspaceId, connectionId)
        api.setAccountIncludedInTotals(
            workspaceId = workspaceId,
            providerId = connection.providerId,
            connectionId = connectionId,
            accountId = accountId,
            includeInTotals = includeInTotals,
        ).getOrThrow()
        // Flipping an account in or out changes the aggregated cash total, which
        // this endpoint does not return, so the grid is re-read rather than patched
        // locally and left disagreeing with the dashboard.
        reload(workspaceId)
    }

    override suspend fun disconnect(workspaceId: String, connectionId: String): Result<Unit> =
        apiCall {
            val connection = requireConnection(workspaceId, connectionId)
            api.disconnect(workspaceId, connection.providerId, connectionId).getOrThrow()
            reload(workspaceId)
        }

    private suspend fun reload(workspaceId: String) {
        val overview = api.integrations(workspaceId).getOrThrow().toDomain(FALLBACK_CURRENCY)
        cached.value = cached.value + (workspaceId to overview)
    }

    /**
     * The cached connection, or a typed failure.
     *
     * [BallastApiError.NotFound] rather than an exception with a developer message,
     * because the honest reading of "this connection is not in the overview" is that
     * it is gone — disconnected on another device, or removed between the grid being
     * drawn and the button being tapped.
     */
    private fun requireConnection(
        workspaceId: String,
        connectionId: String,
    ): IntegrationConnection =
        cached.value[workspaceId]?.connections?.firstOrNull { it.id == connectionId }
            ?: throw BallastApiError.NotFound(
                "That connection is no longer here. Pull to refresh.",
            )
}
