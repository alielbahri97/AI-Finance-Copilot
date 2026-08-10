package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.domain.DashboardRepository
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.apiCall
import com.ballastmoney.android.data.remote.mapper.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The dashboard, backed by `GET /api/dashboard`.
 *
 * Cached per workspace in memory rather than in Room. The snapshot is one derived
 * object — every figure in it is an aggregate the server computed over the whole
 * ledger — so there is no partial version of it worth storing, and nothing in it
 * can be recomputed from the cached transactions. Keying by workspace means
 * switching back and forth does not re-fetch, and means a response for one
 * workspace can never be drawn under another's name.
 *
 * The consequence, stated plainly: a cold start shows the dashboard's loading
 * state rather than yesterday's figures. That is the right trade for a screen
 * whose entire content is "how much money do you have right now".
 */
@Singleton
class NetworkDashboardRepository @Inject constructor(
    private val api: BallastApi,
) : DashboardRepository {

    private val cached = MutableStateFlow<Map<String, DashboardSnapshot>>(emptyMap())

    override fun dashboard(workspaceId: String): Flow<DashboardSnapshot?> =
        cached.map { it[workspaceId] }

    override suspend fun refresh(workspaceId: String): Result<Unit> = apiCall {
        val snapshot = api.dashboard(workspaceId).getOrThrow().toDomain(FALLBACK_CURRENCY)
        // A new map rather than a mutation: the map *is* the StateFlow's value, and
        // a StateFlow only emits when that value compares different.
        cached.value = cached.value + (workspaceId to snapshot)
    }
}
