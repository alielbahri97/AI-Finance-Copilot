package com.ballastmoney.android.data.repository

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.ballastmoney.android.data.local.CategoryDao
import com.ballastmoney.android.data.local.CategoryEntity
import com.ballastmoney.android.data.local.ImportBatchDao
import com.ballastmoney.android.data.local.ImportBatchEntity
import com.ballastmoney.android.data.local.TransactionAggregatesEntity
import com.ballastmoney.android.data.local.TransactionDao
import com.ballastmoney.android.data.local.TransactionEntity
import com.ballastmoney.android.data.local.TransactionPageEntity
import com.ballastmoney.android.data.local.TransactionRemoteKeyEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/**
 * In-memory stand-ins for the three DAOs the paging mediator writes to.
 *
 * Room's own DAOs would be the better test double, but instantiating a
 * generated [com.ballastmoney.android.data.local.BallastDatabase] needs either
 * an instrumented device or Robolectric, and this project has neither on the
 * JVM test path. These fakes implement the same interfaces and keep the same
 * conflict behaviour — an insert replaces a row with the same primary key —
 * which is the only part of Room's semantics the mediator depends on.
 *
 * What they deliberately do *not* reproduce is atomicity: [FakeTransactionRunner]
 * simply runs the block. A test cannot then prove that a half-written page
 * rolls back, and that is stated here rather than implied, because the real
 * guarantee comes from `RoomTransactionRunner` and is not covered.
 */
class FakeTransactionDao : TransactionDao {

    private val rows = MutableStateFlow<Map<String, TransactionEntity>>(emptyMap())
    private val positions = MutableStateFlow<Map<Pair<String, Int>, TransactionPageEntity>>(emptyMap())
    private val remoteKeys = mutableMapOf<String, TransactionRemoteKeyEntity>()
    private val aggregates = MutableStateFlow<Map<String, TransactionAggregatesEntity>>(emptyMap())

    /** The ordering a query would page through, exactly as the join would return it. */
    fun orderedIds(queryKey: String): List<String> = positionsFor(queryKey).map { it.transactionId }

    fun positionsFor(queryKey: String): List<TransactionPageEntity> =
        positions.value.values.filter { it.queryKey == queryKey }.sortedBy { it.position }

    fun storedRow(id: String): TransactionEntity? = rows.value[id]

    val storedRowCount: Int get() = rows.value.size

    override fun pagingSource(queryKey: String): PagingSource<Int, TransactionEntity> =
        OrderedPagingSource(orderedIds(queryKey).mapNotNull { id -> rows.value[id] })

    override fun observe(id: String): Flow<TransactionEntity?> = rows.map { current -> current[id] }

    override suspend fun upsertAll(transactions: List<TransactionEntity>) {
        rows.value = rows.value + transactions.associateBy { it.id }
    }

    override suspend fun upsertPages(pages: List<TransactionPageEntity>) {
        positions.value = positions.value + pages.associateBy { it.queryKey to it.position }
    }

    override suspend fun clearPages(queryKey: String) {
        positions.value = positions.value.filterKeys { (key, _) -> key != queryKey }
    }

    override suspend fun deleteByIds(ids: List<String>) {
        rows.value = rows.value - ids.toSet()
    }

    override suspend fun setCategory(
        ids: List<String>,
        categoryId: String?,
        categoryName: String?,
        categoryColor: String?,
    ) {
        val selected = ids.toSet()
        rows.value = rows.value.mapValues { (_, row) ->
            if (row.id in selected) {
                row.copy(
                    categoryId = categoryId,
                    categoryName = categoryName,
                    categoryColor = categoryColor,
                )
            } else {
                row
            }
        }
    }

    override suspend fun remoteKey(queryKey: String): TransactionRemoteKeyEntity? = remoteKeys[queryKey]

    override suspend fun upsertRemoteKey(key: TransactionRemoteKeyEntity) {
        remoteKeys[key.queryKey] = key
    }

    override suspend fun clearRemoteKey(queryKey: String) {
        remoteKeys.remove(queryKey)
    }

    override suspend fun upsertAggregates(aggregates: TransactionAggregatesEntity) {
        this.aggregates.value = this.aggregates.value + (aggregates.queryKey to aggregates)
    }

    override fun observeAggregates(queryKey: String): Flow<TransactionAggregatesEntity?> =
        aggregates.map { current -> current[queryKey] }

    // The three prefix deletes stand in for `LIKE :prefix || '%'`, which is a
    // plain `startsWith` once the wildcards are out of the picture — a workspace
    // id is a cuid, so it can contain neither `%` nor `_`.
    override suspend fun clearPagesWithPrefix(prefix: String) {
        positions.value = positions.value.filterKeys { (key, _) -> !key.startsWith(prefix) }
    }

    override suspend fun clearRemoteKeysWithPrefix(prefix: String) {
        remoteKeys.keys.filter { key -> key.startsWith(prefix) }.forEach { key ->
            remoteKeys.remove(key)
        }
    }

    override suspend fun clearAggregatesWithPrefix(prefix: String) {
        aggregates.value = aggregates.value.filterKeys { key -> !key.startsWith(prefix) }
    }
}

class FakeCategoryDao : CategoryDao {

    private val rows = MutableStateFlow<Map<String, CategoryEntity>>(emptyMap())

    val stored: List<CategoryEntity> get() = rows.value.values.toList()

    override fun observeAll(workspaceId: String): Flow<List<CategoryEntity>> = rows.map { current ->
        current.values.filter { it.workspaceId == workspaceId }.sortedBy { it.name }
    }

    override suspend fun find(id: String): CategoryEntity? = rows.value[id]

    override suspend fun upsertAll(categories: List<CategoryEntity>) {
        rows.value = rows.value + categories.associateBy { it.id }
    }
}

class FakeImportBatchDao : ImportBatchDao {

    private val rows = MutableStateFlow<Map<String, ImportBatchEntity>>(emptyMap())

    val stored: List<ImportBatchEntity> get() = rows.value.values.toList()

    override fun observeAll(workspaceId: String): Flow<List<ImportBatchEntity>> = rows.map { current ->
        current.values
            .filter { it.workspaceId == workspaceId }
            .sortedByDescending { it.createdAtEpochMillis }
    }

    override suspend fun upsertAll(batches: List<ImportBatchEntity>) {
        rows.value = rows.value + batches.associateBy { it.id }
    }
}

/** Runs the block and counts how many times it was asked to. */
class FakeTransactionRunner : LocalTransactionRunner {

    var commits: Int = 0
        private set

    override suspend fun <R> inTransaction(block: suspend () -> R): R {
        commits++
        return block()
    }
}

/**
 * Enough of a [PagingSource] to page a fixed list. Room generates a far better
 * one; this exists so the fake DAO can honour its own interface rather than
 * throwing from a method the mediator tests happen not to call.
 */
private class OrderedPagingSource(
    private val items: List<TransactionEntity>,
) : PagingSource<Int, TransactionEntity>() {

    override fun getRefreshKey(state: PagingState<Int, TransactionEntity>): Int? = null

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, TransactionEntity> {
        val offset = params.key ?: 0
        val window = items.drop(offset).take(params.loadSize)
        return LoadResult.Page(
            data = window,
            prevKey = null,
            nextKey = if (offset + window.size >= items.size) null else offset + window.size,
        )
    }
}
