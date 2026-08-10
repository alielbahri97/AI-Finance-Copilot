package com.ballastmoney.android.data.fake

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.ballastmoney.android.core.domain.DashboardRepository
import com.ballastmoney.android.core.domain.IntegrationsRepository
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.TransactionsRepository
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.SyncOutcome
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionDraft
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.core.model.TransactionType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.math.BigDecimal
import java.time.Instant
import java.time.ZoneOffset
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max

/**
 * In-memory stand-ins for the repositories, used until the JSON API exists.
 *
 * They deliberately behave like the real thing rather than returning a constant:
 * refreshes take a moment so loading states are visible, filters and sorting are
 * applied for real so the transactions screen can be tested, and writes mutate
 * shared state so an added transaction shows up in the list and in the totals.
 * Anything these fakes get wrong is a bug the screens would also have against
 * the real API.
 */
private const val FAKE_LATENCY_MS = 450L

@Singleton
class FakeSessionRepository @Inject constructor() : SessionRepository {

    private val currentWorkspaceId = MutableStateFlow(FakeBallastData.BUSINESS_WORKSPACE_ID)
    private val state = MutableStateFlow<SessionBootstrap?>(null)

    override val session: Flow<SessionBootstrap?> = state.asStateFlow()

    override suspend fun refresh(): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        state.value = FakeBallastData.sessionFor(currentWorkspaceId.value)
        return Result.success(Unit)
    }

    override suspend fun selectWorkspace(workspaceId: String): Result<Unit> {
        currentWorkspaceId.value = workspaceId
        // Permissions, edition and currency all change with the workspace, so a
        // switch is a full re-bootstrap rather than a field update.
        return refresh()
    }

    override suspend fun signOut(): Result<Unit> {
        state.value = null
        return Result.success(Unit)
    }
}

@Singleton
class FakeDashboardRepository @Inject constructor() : DashboardRepository {

    private val snapshots = MutableStateFlow<Map<String, DashboardSnapshot>>(emptyMap())

    override fun dashboard(workspaceId: String): Flow<DashboardSnapshot?> =
        snapshots.map { it[workspaceId] }

    override suspend fun refresh(workspaceId: String): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        snapshots.update { it + (workspaceId to FakeBallastData.dashboardFor(workspaceId)) }
        return Result.success(Unit)
    }
}

@Singleton
class FakeTransactionsRepository @Inject constructor() : TransactionsRepository {

    private val transactions = MutableStateFlow(FakeBallastData.transactions)
    private val categories = MutableStateFlow(FakeBallastData.categories)
    private val batches = MutableStateFlow(FakeBallastData.importBatches)
    private var nextId = 9_000

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    override fun pagedTransactions(
        workspaceId: String,
        query: TransactionQuery,
    ): Flow<PagingData<Transaction>> = transactions.flatMapLatest { all ->
        val matching = applyQuery(all, query)
        Pager(
            config = PagingConfig(
                pageSize = query.pageSize,
                initialLoadSize = query.pageSize,
                enablePlaceholders = false,
            ),
            pagingSourceFactory = { OffsetPagingSource(matching) },
        ).flow
    }

    override fun aggregates(
        workspaceId: String,
        query: TransactionQuery,
    ): Flow<TransactionAggregates?> = transactions.map { all ->
        val matching = applyQuery(all, query)
        val income = matching.filter { it.type == TransactionType.INCOME }
            .fold(BigDecimal.ZERO) { acc, t -> acc.add(t.amount) }
        val expenses = matching.filter { it.type == TransactionType.EXPENSE }
            .fold(BigDecimal.ZERO) { acc, t -> acc.add(t.amount) }
        TransactionAggregates(
            income = income,
            expenses = expenses,
            net = income.subtract(expenses),
            totalCount = matching.size,
        )
    }

    override fun categories(workspaceId: String): Flow<List<Category>> = categories.asStateFlow()

    override fun importBatches(workspaceId: String): Flow<List<ImportBatch>> = batches.asStateFlow()

    override suspend fun add(workspaceId: String, draft: TransactionDraft): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        val category = draft.categoryId?.let { id -> categories.value.firstOrNull { it.id == id } }
        val created = Transaction(
            id = "tx_local_${nextId++}",
            type = draft.type,
            amount = draft.amount,
            description = draft.description,
            date = draft.date.atStartOfDay().toInstant(ZoneOffset.UTC),
            categoryId = category?.id,
            categoryName = category?.name,
            categoryColor = category?.color,
            counterparty = draft.counterparty,
        )
        transactions.update { current ->
            (current + created).sortedWith(
                compareByDescending<Transaction> { it.date }.thenByDescending { it.id },
            )
        }
        return Result.success(Unit)
    }

    override suspend fun update(
        workspaceId: String,
        transactionId: String,
        draft: TransactionDraft,
    ): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        val category = draft.categoryId?.let { id -> categories.value.firstOrNull { it.id == id } }
        transactions.update { current ->
            current.map { existing ->
                if (existing.id != transactionId) {
                    existing
                } else {
                    existing.copy(
                        type = draft.type,
                        amount = draft.amount,
                        description = draft.description,
                        date = draft.date.atStartOfDay().toInstant(ZoneOffset.UTC),
                        categoryId = category?.id,
                        categoryName = category?.name,
                        categoryColor = category?.color,
                        counterparty = draft.counterparty,
                    )
                }
            }
        }
        return Result.success(Unit)
    }

    override suspend fun setCategory(
        workspaceId: String,
        transactionIds: List<String>,
        categoryId: String?,
    ): Result<Unit> {
        if (transactionIds.size > BULK_LIMIT) {
            return Result.failure(IllegalArgumentException("At most $BULK_LIMIT transactions at a time"))
        }
        delay(FAKE_LATENCY_MS)
        val category = categoryId?.let { id -> categories.value.firstOrNull { it.id == id } }
        val ids = transactionIds.toSet()
        transactions.update { current ->
            current.map { existing ->
                if (existing.id !in ids) {
                    existing
                } else {
                    existing.copy(
                        categoryId = category?.id,
                        categoryName = category?.name,
                        categoryColor = category?.color,
                    )
                }
            }
        }
        return Result.success(Unit)
    }

    override suspend fun delete(workspaceId: String, transactionIds: List<String>): Result<Unit> {
        if (transactionIds.size > BULK_LIMIT) {
            return Result.failure(IllegalArgumentException("At most $BULK_LIMIT transactions at a time"))
        }
        delay(FAKE_LATENCY_MS)
        val ids = transactionIds.toSet()
        transactions.update { current -> current.filterNot { it.id in ids } }
        return Result.success(Unit)
    }

    /**
     * Applies the same filters and ordering the server would, so the screen is
     * exercised against realistic behaviour instead of a fixed list.
     */
    private fun applyQuery(all: List<Transaction>, query: TransactionQuery): List<Transaction> {
        if (query.hasInvalidRange) return emptyList()

        val search = query.search.trim()
        val filtered = all.asSequence()
            .filter { query.type == null || it.type == query.type }
            .filter { transaction ->
                when (query.categoryId) {
                    null -> true
                    TransactionQuery.UNCATEGORIZED -> transaction.categoryId == null
                    else -> transaction.categoryId == query.categoryId
                }
            }
            .filter { query.importBatchId == null || it.importBatchId == query.importBatchId }
            .filter { transaction ->
                if (search.isEmpty()) {
                    true
                } else {
                    transaction.description.contains(search, ignoreCase = true) ||
                        transaction.counterparty?.contains(search, ignoreCase = true) == true
                }
            }
            .filter { transaction ->
                val date = transaction.date.atZone(ZoneOffset.UTC).toLocalDate()
                val afterFrom = query.from?.let { !date.isBefore(it) } ?: true
                val beforeTo = query.to?.let { !date.isAfter(it) } ?: true
                afterFrom && beforeTo
            }
            .filter { transaction ->
                val aboveMin = query.minAmount?.let { transaction.amount >= it } ?: true
                val belowMax = query.maxAmount?.let { transaction.amount <= it } ?: true
                aboveMin && belowMax
            }
            .toList()

        val comparator: Comparator<Transaction> = when (query.sort) {
            TransactionSortKey.DATE -> compareBy { it.date }
            TransactionSortKey.AMOUNT -> compareBy { it.amount }
            TransactionSortKey.DESCRIPTION -> compareBy(String.CASE_INSENSITIVE_ORDER) { it.description }
            TransactionSortKey.CATEGORY -> compareBy(nullsLast(String.CASE_INSENSITIVE_ORDER)) { it.categoryName }
        }
        // Ties break on date then id, mirroring the server's secondary sort on
        // date and createdAt, so paging cannot show the same row twice.
        val stable = comparator
            .thenByDescending<Transaction> { it.date }
            .thenByDescending { it.id }

        return if (query.direction == SortDirection.ASC) {
            filtered.sortedWith(stable)
        } else {
            filtered.sortedWith(comparator.reversed().thenByDescending { it.date }.thenByDescending { it.id })
        }
    }

    private companion object {
        const val BULK_LIMIT = 1_000
    }
}

@Singleton
class FakeIntegrationsRepository @Inject constructor() : IntegrationsRepository {

    private val overviews = MutableStateFlow<Map<String, IntegrationsOverview>>(emptyMap())

    override fun overview(workspaceId: String): Flow<IntegrationsOverview?> =
        overviews.map { it[workspaceId] }

    override suspend fun refresh(workspaceId: String): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        overviews.update { it + (workspaceId to FakeBallastData.integrationsFor(workspaceId)) }
        return Result.success(Unit)
    }

    override suspend fun sync(workspaceId: String, connectionId: String): Result<SyncOutcome> {
        delay(1_200)
        val overview = overviews.value[workspaceId] ?: return Result.failure(IllegalStateException("Not loaded"))
        val connection = overview.connections.firstOrNull { it.id == connectionId }
            ?: return Result.failure(IllegalStateException("Unknown connection"))

        // An expired consent cannot sync. Failing here rather than pretending to
        // succeed is what makes the error path on the screen real.
        if (connection.status == ConnectionStatus.EXPIRED) {
            return Result.failure(IllegalStateException("Access expired — reconnect to resume syncing."))
        }

        val updated = overview.copy(
            connections = overview.connections.map { existing ->
                if (existing.id == connectionId) existing.copy(lastSyncAt = Instant.now()) else existing
            },
        )
        overviews.update { it + (workspaceId to updated) }
        return Result.success(
            SyncOutcome(
                connectionTitle = connection.title,
                stats = mapOf("transactions" to 14, "accounts" to connection.accounts.size),
            ),
        )
    }

    override suspend fun setIncludeInTotals(
        workspaceId: String,
        connectionId: String,
        accountId: String,
        includeInTotals: Boolean,
    ): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        val overview = overviews.value[workspaceId] ?: return Result.failure(IllegalStateException("Not loaded"))
        val updated = overview.copy(
            connections = overview.connections.map { connection ->
                if (connection.id != connectionId) {
                    connection
                } else {
                    connection.copy(
                        accounts = connection.accounts.map { account ->
                            if (account.id == accountId) {
                                account.copy(includeInTotals = includeInTotals)
                            } else {
                                account
                            }
                        },
                    )
                }
            },
        )
        overviews.update { it + (workspaceId to updated) }
        return Result.success(Unit)
    }

    override suspend fun disconnect(workspaceId: String, connectionId: String): Result<Unit> {
        delay(FAKE_LATENCY_MS)
        val overview = overviews.value[workspaceId] ?: return Result.failure(IllegalStateException("Not loaded"))
        val updated = overview.copy(connections = overview.connections.filterNot { it.id == connectionId })
        overviews.update { it + (workspaceId to updated) }
        return Result.success(Unit)
    }
}

/**
 * Offset-keyed paging over a list, matching how the real endpoint pages so the
 * screen's paging behaviour is the same in both worlds.
 */
private class OffsetPagingSource(
    private val items: List<Transaction>,
) : PagingSource<Int, Transaction>() {

    override fun getRefreshKey(state: PagingState<Int, Transaction>): Int? =
        state.anchorPosition?.let { anchor ->
            max(0, anchor - state.config.initialLoadSize / 2)
        }

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, Transaction> {
        val offset = params.key ?: 0
        val limit = params.loadSize
        val window = items.drop(offset).take(limit)
        return LoadResult.Page(
            data = window,
            prevKey = if (offset <= 0) null else max(0, offset - limit),
            nextKey = if (offset + window.size >= items.size) null else offset + window.size,
        )
    }
}
