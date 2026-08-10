package com.ballastmoney.android.core.domain

import androidx.paging.PagingData
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.core.model.SyncOutcome
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import kotlinx.coroutines.flow.Flow

/**
 * The contract the real network layer has to satisfy.
 *
 * Every repository follows the same two-part shape, which is what makes the
 * local cache the source of truth rather than a nice-to-have:
 *
 *  - reads are cold [Flow]s that emit whatever is cached and keep emitting as
 *    the cache changes. They never throw and never surface a loading state; an
 *    empty cache emits null or an empty list.
 *  - writes and refreshes are `suspend` functions returning [Result], so the
 *    caller decides whether a failure is a toast, a retry or a full error
 *    screen.
 *
 * Because of that split, swapping the in-memory fake for the Ktor-backed
 * implementation is a one-line binding change per repository in
 * `di/RepositoryModule.kt` — no ViewModel or screen has to change.
 */

/** Backed by `GET /api/session/bootstrap`. */
interface SessionRepository {
    /** Null until the first successful bootstrap. */
    val session: Flow<SessionBootstrap?>

    suspend fun refresh(): Result<Unit>

    /**
     * Switches the active workspace. The server sets the workspace cookie; the
     * client re-bootstraps because permissions, edition and currency all change.
     */
    suspend fun selectWorkspace(workspaceId: String): Result<Unit>

    suspend fun signOut(): Result<Unit>
}

/** Backed by `GET /api/dashboard`. */
interface DashboardRepository {
    fun dashboard(workspaceId: String): Flow<DashboardSnapshot?>

    suspend fun refresh(workspaceId: String): Result<Unit>
}

/**
 * Backed by `GET /api/transactions`.
 *
 * [pagedTransactions] is where Paging 3 earns its place: the endpoint supports
 * filtering, sorting and offset paging, so a `RemoteMediator` can page into
 * Room and the list survives rotation, process death and going offline.
 * [aggregates] is separate because the server computes totals over the entire
 * filtered set, which the paged window cannot.
 */
interface TransactionsRepository {
    fun pagedTransactions(workspaceId: String, query: TransactionQuery): Flow<PagingData<Transaction>>

    fun aggregates(workspaceId: String, query: TransactionQuery): Flow<TransactionAggregates?>

    fun categories(workspaceId: String): Flow<List<Category>>

    fun importBatches(workspaceId: String): Flow<List<ImportBatch>>

    suspend fun add(workspaceId: String, draft: TransactionDraft): Result<Unit>

    suspend fun update(workspaceId: String, transactionId: String, draft: TransactionDraft): Result<Unit>

    /** Bulk recategorise. A null [categoryId] clears the category. */
    suspend fun setCategory(workspaceId: String, transactionIds: List<String>, categoryId: String?): Result<Unit>

    suspend fun delete(workspaceId: String, transactionIds: List<String>): Result<Unit>
}

/** Backed by `GET /api/integrations` and its provider sub-routes. */
interface IntegrationsRepository {
    fun overview(workspaceId: String): Flow<IntegrationsOverview?>

    suspend fun refresh(workspaceId: String): Result<Unit>

    suspend fun sync(workspaceId: String, connectionId: String): Result<SyncOutcome>

    suspend fun setIncludeInTotals(
        workspaceId: String,
        connectionId: String,
        accountId: String,
        includeInTotals: Boolean,
    ): Result<Unit>

    suspend fun disconnect(workspaceId: String, connectionId: String): Result<Unit>
}
