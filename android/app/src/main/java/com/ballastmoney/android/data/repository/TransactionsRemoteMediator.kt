package com.ballastmoney.android.data.repository

import androidx.paging.ExperimentalPagingApi
import androidx.paging.LoadType
import androidx.paging.PagingState
import androidx.paging.RemoteMediator
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.data.local.CategoryDao
import com.ballastmoney.android.data.local.CategoryEntity
import com.ballastmoney.android.data.local.ImportBatchDao
import com.ballastmoney.android.data.local.ImportBatchEntity
import com.ballastmoney.android.data.local.TransactionAggregatesEntity
import com.ballastmoney.android.data.local.TransactionDao
import com.ballastmoney.android.data.local.TransactionEntity
import com.ballastmoney.android.data.local.TransactionPageEntity
import com.ballastmoney.android.data.local.TransactionRemoteKeyEntity
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.dto.TransactionsResponseDto
import com.ballastmoney.android.data.remote.mapper.categoriesSeen
import com.ballastmoney.android.data.remote.mapper.toAggregates
import com.ballastmoney.android.data.remote.mapper.toDomain
import com.ballastmoney.android.data.remote.toBallastApiError
import kotlinx.coroutines.CancellationException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * Pages `GET /api/transactions` into Room, which the list then reads from.
 *
 * Room is the single source of truth: the UI never sees a network response.
 * `TransactionDao.pagingSource` reads the rows, so anything that writes to those
 * tables — this mediator, a bulk recategorise, a delete — invalidates the source
 * and the list redraws. That is what makes the screen work offline and survive
 * process death rather than merely rotation.
 *
 * ### Why the server's page number is checked rather than trusted
 *
 * The endpoint **clamps**: asking for page 40 of a three-page set returns page 3,
 * not an empty list. A mediator that assumed it got the page it asked for would
 * append page 3 to itself forever, duplicating every row and never reaching the
 * end. So the served page is compared with the requested one, and a smaller
 * answer is read as "there was nothing after all" — those rows are already in the
 * database and are not written again.
 *
 * ### Why positions are stored
 *
 * The order is the server's. Sorting by category name, or by amount with date and
 * `createdAt` as tie-breakers, cannot be reproduced from the cached columns —
 * `createdAt` is not even stored. So each page records "for this query, position
 * N is transaction X" and the paging query replays exactly that, while the
 * transaction rows themselves stay shared between queries and deduplicated by id.
 *
 * ### Why the dependencies are DAOs and a runner
 *
 * Taking the three DAOs and a [LocalTransactionRunner] rather than the
 * [com.ballastmoney.android.data.local.BallastDatabase] is what makes this class
 * testable at all: the database is a Room-generated type that needs a device or
 * Robolectric, and neither is available to these unit tests. The DAOs are plain
 * interfaces that a fake can implement.
 */
@OptIn(ExperimentalPagingApi::class)
class TransactionsRemoteMediator(
    private val workspaceId: String,
    private val query: TransactionQuery,
    private val pageSize: Int,
    private val api: BallastApi,
    private val transactionDao: TransactionDao,
    private val categoryDao: CategoryDao,
    private val importBatchDao: ImportBatchDao,
    private val runner: LocalTransactionRunner,
    private val cacheTimeout: Duration = CACHE_TIMEOUT,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis,
) : RemoteMediator<Int, TransactionEntity>() {

    private val queryKey = transactionQueryKey(workspaceId, query)

    /**
     * Whether to hit the network before showing anything.
     *
     * A cache younger than [cacheTimeout] is shown and not refreshed, which is
     * what makes returning to the list instant. Beyond that the rows are still
     * shown — [InitializeAction.LAUNCH_INITIAL_REFRESH] does not clear them — but
     * a refresh runs behind them, so the user reads slightly stale figures for a
     * moment rather than watching a spinner.
     */
    override suspend fun initialize(): InitializeAction {
        val key = transactionDao.remoteKey(queryKey) ?: return InitializeAction.LAUNCH_INITIAL_REFRESH
        val age = nowEpochMillis() - key.lastRefreshEpochMillis
        return if (age <= cacheTimeout.inWholeMilliseconds) {
            InitializeAction.SKIP_INITIAL_REFRESH
        } else {
            InitializeAction.LAUNCH_INITIAL_REFRESH
        }
    }

    override suspend fun load(
        loadType: LoadType,
        state: PagingState<Int, TransactionEntity>,
    ): MediatorResult {
        // An inverted date range matches nothing by definition, and the server
        // would agree at the cost of a round trip. Answering locally keeps the
        // empty state instant while the user is still adjusting the dates.
        if (query.hasInvalidRange) {
            return MediatorResult.Success(endOfPaginationReached = true)
        }

        val requestedPage = when (loadType) {
            LoadType.REFRESH -> FIRST_PAGE

            // Offset paging only goes forward, and the first page is always page
            // one, so there is never anything before what is loaded.
            LoadType.PREPEND -> return MediatorResult.Success(endOfPaginationReached = true)

            LoadType.APPEND -> {
                val key = transactionDao.remoteKey(queryKey)
                when {
                    // No bookkeeping means nothing is loaded for this query, so
                    // "the next page" is the first one. This is the state a write
                    // leaves behind — `clearCachedQueries` drops the orderings,
                    // Room invalidates the paging source, and the reload arrives
                    // here rather than through REFRESH. Reporting "not the end"
                    // instead would leave an empty list that Paging asks about
                    // again immediately, forever.
                    key == null -> FIRST_PAGE
                    key.endOfPaginationReached ->
                        return MediatorResult.Success(endOfPaginationReached = true)
                    else -> key.nextOffset / pageSize + 1
                }
            }
        }

        return try {
            val response = api
                .transactions(workspaceId, query, requestedPage, pageSize)
                .getOrThrow()
            val clamped = response.page < requestedPage
            val endReached = clamped || response.isLastPage()

            runner.inTransaction {
                if (loadType == LoadType.REFRESH) {
                    // Only this query's ordering is dropped. The transaction rows
                    // survive, because another filter may be showing them and
                    // because re-inserting an unchanged row is cheaper than
                    // fetching it again.
                    transactionDao.clearPages(queryKey)
                    transactionDao.clearRemoteKey(queryKey)
                }

                // Totals cover the whole filtered set and batches the whole
                // workspace, so both are written on every page: the server
                // recomputes them per request and the newest answer is the right
                // one to keep.
                transactionDao.upsertAggregates(response.toAggregatesEntity())
                importBatchDao.upsertAll(response.toBatchEntities())
                categoryDao.upsertAll(response.toCategoryEntities())

                val offset = (requestedPage - 1) * pageSize
                if (!clamped) {
                    transactionDao.upsertAll(response.toTransactionEntities())
                    transactionDao.upsertPages(response.toPageEntities(offset))
                }

                transactionDao.upsertRemoteKey(
                    TransactionRemoteKeyEntity(
                        queryKey = queryKey,
                        // Nothing new landed on a clamped answer, so the next
                        // offset has not moved.
                        nextOffset = if (clamped) {
                            transactionDao.remoteKey(queryKey)?.nextOffset ?: 0
                        } else {
                            offset + response.transactions.size
                        },
                        endOfPaginationReached = endReached,
                        lastRefreshEpochMillis = nowEpochMillis(),
                    ),
                )
            }

            MediatorResult.Success(endOfPaginationReached = endReached)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Throwable) {
            // `getOrThrow` above rethrows the BallastApiError the API already
            // classified, and `toBallastApiError` passes an existing one straight
            // through. The conversion is here for the local writes, which can fail
            // with a SQLite exception that Paging should show as a footer rather
            // than let crash the collector.
            MediatorResult.Error(failure.toBallastApiError())
        }
    }

    private fun TransactionsResponseDto.isLastPage(): Boolean =
        transactions.isEmpty() || page >= pageCount

    private fun TransactionsResponseDto.toTransactionEntities(): List<TransactionEntity> =
        transactions.map { dto -> TransactionEntity.fromDomain(workspaceId, dto.toDomain()) }

    private fun TransactionsResponseDto.toPageEntities(offset: Int): List<TransactionPageEntity> =
        transactions.mapIndexed { index, dto ->
            TransactionPageEntity(
                queryKey = queryKey,
                position = offset + index,
                transactionId = dto.id,
            )
        }

    private fun TransactionsResponseDto.toAggregatesEntity(): TransactionAggregatesEntity {
        val aggregates = toAggregates()
        return TransactionAggregatesEntity(
            queryKey = queryKey,
            incomeMinor = aggregates.income.toMinorUnits(),
            expensesMinor = aggregates.expenses.toMinorUnits(),
            netMinor = aggregates.net.toMinorUnits(),
            totalCount = aggregates.totalCount,
        )
    }

    private fun TransactionsResponseDto.toBatchEntities(): List<ImportBatchEntity> =
        batches.map { dto ->
            val batch = dto.toDomain()
            ImportBatchEntity(
                id = batch.id,
                workspaceId = workspaceId,
                fileName = batch.fileName,
                createdAtEpochMillis = batch.createdAt.toEpochMilli(),
            )
        }

    private fun TransactionsResponseDto.toCategoryEntities(): List<CategoryEntity> =
        categoriesSeen().map { category ->
            CategoryEntity(
                id = category.id,
                workspaceId = workspaceId,
                name = category.name,
                type = category.type,
                color = category.color,
            )
        }

    companion object {
        /** The contract's pages are 1-based. */
        const val FIRST_PAGE = 1

        /**
         * How long a cached result set is shown without re-fetching.
         *
         * Five minutes, sized to the data: a ledger changes when the user imports
         * or a bank syncs, neither of which happens minute to minute, so
         * refreshing more eagerly would spend a mobile connection to confirm that
         * nothing changed. A manual pull-to-refresh is not subject to this — it
         * forces a REFRESH regardless.
         */
        val CACHE_TIMEOUT: Duration = 5.minutes
    }
}
