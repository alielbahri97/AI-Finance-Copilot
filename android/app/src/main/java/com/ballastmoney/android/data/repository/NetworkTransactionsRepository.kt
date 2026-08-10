package com.ballastmoney.android.data.repository

import androidx.paging.ExperimentalPagingApi
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.ballastmoney.android.core.domain.TransactionsRepository
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.data.local.BallastDatabase
import com.ballastmoney.android.data.local.CategoryEntity
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.apiCall
import com.ballastmoney.android.data.remote.mapper.DEFAULT_CATEGORY_COLOR
import com.ballastmoney.android.data.remote.mapper.transactionTypeOf
import com.ballastmoney.android.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The ledger, backed by `GET /api/transactions` paging into Room.
 *
 * Unlike the other three this repository really does cache to the database,
 * because the transactions list is the one screen where that pays for itself:
 * it is long, the user scrolls it, and it is worth reading on a train. The
 * [TransactionsRemoteMediator] is where the paging happens; this class assembles
 * it and serves everything else the screen needs from the same tables.
 *
 * ### Writes go to the server first, and the outbox stays empty
 *
 * The `outbox` table is deliberately not used, which is a decision rather than an
 * omission. An optimistic write here would have to answer two questions the
 * device cannot: **where does the row go**, when the ordering may be by category
 * name with date and a `createdAt` the client never receives as tie-breakers; and
 * **what are the totals now**, when they are aggregated server-side over every
 * row matching the filter, not over the loaded page. Guessing either produces a
 * row in the wrong position and totals that disagree with the header â€” visibly
 * wrong, and wrong in the direction that makes a user distrust their own
 * accounts.
 *
 * So a write is sent, and on success this workspace's cached orderings and totals
 * are dropped so the list re-reads them. The cost is a round trip before the
 * change appears. The benefit is that what appears is what the server actually
 * holds. The outbox remains the right shape for a genuinely offline-first write
 * queue if one is ever wanted; it just cannot be filled honestly today.
 */
@OptIn(ExperimentalPagingApi::class)
@Singleton
class NetworkTransactionsRepository @Inject constructor(
    private val api: BallastApi,
    private val database: BallastDatabase,
    @ApplicationScope private val scope: CoroutineScope,
) : TransactionsRepository {

    private val transactionDao = database.transactionDao()
    private val categoryDao = database.categoryDao()
    private val importBatchDao = database.importBatchDao()

    override fun pagedTransactions(
        workspaceId: String,
        query: TransactionQuery,
    ): Flow<PagingData<Transaction>> {
        val queryKey = transactionQueryKey(workspaceId, query)
        // One size for the API request, the Paging config and the offset
        // arithmetic. They have to agree: the mediator turns a row offset back
        // into a page number by dividing by this, so a Paging page of 20 against
        // an API page of 25 would ask for the wrong page and skip rows silently.
        // It is also part of the query key, so the cached positions were computed
        // with it too.
        val pageSize = allowedPageSize(query.pageSize)
        return Pager(
            config = PagingConfig(
                pageSize = pageSize,
                // Matched to the page size so one page is loaded ahead: the
                // network page and the prefetch distance being the same means a
                // scroll triggers exactly one fetch rather than two.
                prefetchDistance = pageSize,
                // The server's page is the unit of work, so there is nothing to
                // gain from Room handing out a different first size.
                initialLoadSize = pageSize,
                enablePlaceholders = false,
            ),
            remoteMediator = TransactionsRemoteMediator(
                workspaceId = workspaceId,
                query = query,
                pageSize = pageSize,
                api = api,
                transactionDao = transactionDao,
                categoryDao = categoryDao,
                importBatchDao = importBatchDao,
                runner = RoomTransactionRunner(database),
            ),
            pagingSourceFactory = { transactionDao.pagingSource(queryKey) },
        ).flow.map { paging -> paging.map { entity -> entity.toDomain() } }
    }

    override fun aggregates(
        workspaceId: String,
        query: TransactionQuery,
    ): Flow<TransactionAggregates?> =
        transactionDao.observeAggregates(transactionQueryKey(workspaceId, query))
            .map { entity -> entity?.toDomain() }

    /**
     * Every category the workspace defines.
     *
     * Read from Room, which two sources fill: `GET /api/categories` on first
     * collection, and the categories seen on transaction rows as they page in.
     * The endpoint is the better source â€” it knows about a category with no
     * transactions yet, which the picker has to offer â€” but it is outside the
     * frozen mobile contract, so its failure is silent and the accumulated set
     * carries on being useful.
     *
     * The fetch is launched into the application scope rather than awaited, so
     * the first emission is whatever is cached and arrives immediately.
     */
    override fun categories(workspaceId: String): Flow<List<Category>> =
        categoryDao.observeAll(workspaceId)
            .map { entities -> entities.map { it.toDomain() } }
            .onStart { scope.launch { refreshCategories(workspaceId) } }

    override fun importBatches(workspaceId: String): Flow<List<ImportBatch>> =
        importBatchDao.observeAll(workspaceId)
            .map { entities -> entities.map { it.toDomain() } }

    override suspend fun add(workspaceId: String, draft: TransactionDraft): Result<Unit> =
        apiCall {
            api.createTransaction(workspaceId, draft).getOrThrow()
            invalidate(workspaceId)
        }

    override suspend fun update(
        workspaceId: String,
        transactionId: String,
        draft: TransactionDraft,
    ): Result<Unit> = apiCall {
        api.updateTransaction(workspaceId, transactionId, draft).getOrThrow()
        invalidate(workspaceId)
    }

    /**
     * Bulk recategorise.
     *
     * The category is also written straight onto the cached rows, which is the
     * one optimistic update that is safe: a category change cannot move a row
     * within a date or amount ordering and cannot change the income or expense
     * totals. It does affect a *category* ordering and the category filter, which
     * is why the invalidation still happens â€” this only removes the flicker of
     * seeing the old label for the length of a round trip.
     */
    override suspend fun setCategory(
        workspaceId: String,
        transactionIds: List<String>,
        categoryId: String?,
    ): Result<Unit> = apiCall {
        api.setTransactionCategory(workspaceId, transactionIds, categoryId).getOrThrow()
        val category = categoryId?.let { categoryDao.find(it) }
        transactionDao.setCategory(
            ids = transactionIds,
            categoryId = categoryId,
            categoryName = category?.name,
            categoryColor = category?.color,
        )
        invalidate(workspaceId)
    }

    override suspend fun delete(
        workspaceId: String,
        transactionIds: List<String>,
    ): Result<Unit> = apiCall {
        api.deleteTransactions(workspaceId, transactionIds).getOrThrow()
        // Removed locally as well as invalidated, so a deleted row does not linger
        // for the length of the refetch. Safe in a way an insert is not: taking a
        // row out cannot put anything in the wrong place.
        transactionDao.deleteByIds(transactionIds)
        invalidate(workspaceId)
    }

    private suspend fun invalidate(workspaceId: String) {
        transactionDao.clearCachedQueries(transactionQueryKeyPrefix(workspaceId))
    }

    private suspend fun refreshCategories(workspaceId: String) {
        runCatching {
            val categories = api.categories(workspaceId).getOrThrow().categories.map { dto ->
                CategoryEntity(
                    id = dto.id,
                    workspaceId = workspaceId,
                    name = dto.name,
                    type = transactionTypeOf(dto.type),
                    color = dto.color ?: DEFAULT_CATEGORY_COLOR,
                )
            }
            categoryDao.upsertAll(categories)
        }
    }
}
