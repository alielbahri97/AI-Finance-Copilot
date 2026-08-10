package com.ballastmoney.android.data.local

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction as RoomTransaction
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.ballastmoney.android.core.model.TransactionType
import kotlinx.coroutines.flow.Flow

@Dao
interface TransactionDao {

    /**
     * Pages a query's results in the order the server returned them.
     *
     * Room generates a [PagingSource] and invalidates it whenever either table
     * changes, which is what makes the cache the source of truth: a write lands
     * in Room and the list updates, whether the write came from the network or
     * from an optimistic local edit.
     */
    @RoomTransaction
    @Query(
        """
        SELECT t.* FROM transactions t
        INNER JOIN transaction_pages p ON p.transactionId = t.id
        WHERE p.queryKey = :queryKey
        ORDER BY p.position ASC
        """
    )
    fun pagingSource(queryKey: String): PagingSource<Int, TransactionEntity>

    @Query("SELECT * FROM transactions WHERE id = :id")
    fun observe(id: String): Flow<TransactionEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(transactions: List<TransactionEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPages(pages: List<TransactionPageEntity>)

    @Query("DELETE FROM transaction_pages WHERE queryKey = :queryKey")
    suspend fun clearPages(queryKey: String)

    @Query("DELETE FROM transactions WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("UPDATE transactions SET categoryId = :categoryId, categoryName = :categoryName, categoryColor = :categoryColor WHERE id IN (:ids)")
    suspend fun setCategory(ids: List<String>, categoryId: String?, categoryName: String?, categoryColor: String?)

    @Query("SELECT * FROM transaction_remote_keys WHERE queryKey = :queryKey")
    suspend fun remoteKey(queryKey: String): TransactionRemoteKeyEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRemoteKey(key: TransactionRemoteKeyEntity)

    @Query("DELETE FROM transaction_remote_keys WHERE queryKey = :queryKey")
    suspend fun clearRemoteKey(queryKey: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAggregates(aggregates: TransactionAggregatesEntity)

    @Query("SELECT * FROM transaction_aggregates WHERE queryKey = :queryKey")
    fun observeAggregates(queryKey: String): Flow<TransactionAggregatesEntity?>

    /**
     * Throws away every cached result set for one workspace.
     *
     * Called after a write. A new, edited or deleted transaction can change which
     * rows match a filter, where they fall in the ordering and what the totals
     * come to — for every filter the user has visited, not just the one on
     * screen — and none of that is computable on the device. So the orderings and
     * the totals go, the transaction rows stay, and the next load re-reads them
     * from the server.
     *
     * Matched on the query key's prefix, which by construction is the workspace
     * id followed by a separator. `LIKE` treats `%` and `_` as wildcards; a
     * workspace id is a cuid, so neither can appear in one.
     */
    @RoomTransaction
    suspend fun clearCachedQueries(workspaceIdPrefix: String) {
        clearPagesWithPrefix(workspaceIdPrefix)
        clearRemoteKeysWithPrefix(workspaceIdPrefix)
        clearAggregatesWithPrefix(workspaceIdPrefix)
    }

    @Query("DELETE FROM transaction_pages WHERE queryKey LIKE :prefix || '%'")
    suspend fun clearPagesWithPrefix(prefix: String)

    @Query("DELETE FROM transaction_remote_keys WHERE queryKey LIKE :prefix || '%'")
    suspend fun clearRemoteKeysWithPrefix(prefix: String)

    @Query("DELETE FROM transaction_aggregates WHERE queryKey LIKE :prefix || '%'")
    suspend fun clearAggregatesWithPrefix(prefix: String)
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories WHERE workspaceId = :workspaceId ORDER BY name ASC")
    fun observeAll(workspaceId: String): Flow<List<CategoryEntity>>

    /** For labelling rows after a recategorise, without waiting for a refetch. */
    @Query("SELECT * FROM categories WHERE id = :id")
    suspend fun find(id: String): CategoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(categories: List<CategoryEntity>)
}

@Dao
interface ImportBatchDao {
    @Query("SELECT * FROM import_batches WHERE workspaceId = :workspaceId ORDER BY createdAtEpochMillis DESC")
    fun observeAll(workspaceId: String): Flow<List<ImportBatchEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(batches: List<ImportBatchEntity>)
}

@Dao
interface OutboxDao {
    @Query("SELECT * FROM outbox ORDER BY createdAtEpochMillis ASC")
    fun observeAll(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox ORDER BY createdAtEpochMillis ASC LIMIT :limit")
    suspend fun next(limit: Int): List<OutboxEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(entry: OutboxEntity)

    @Delete
    suspend fun delete(entry: OutboxEntity)

    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :error WHERE id = :id")
    suspend fun recordFailure(id: String, error: String?)
}

class BallastTypeConverters {
    @TypeConverter
    fun toTransactionType(value: String): TransactionType = TransactionType.valueOf(value)

    @TypeConverter
    fun fromTransactionType(value: TransactionType): String = value.name

    @TypeConverter
    fun toOutboxKind(value: String): OutboxKind = OutboxKind.valueOf(value)

    @TypeConverter
    fun fromOutboxKind(value: OutboxKind): String = value.name
}

@Database(
    entities = [
        TransactionEntity::class,
        TransactionPageEntity::class,
        TransactionRemoteKeyEntity::class,
        TransactionAggregatesEntity::class,
        CategoryEntity::class,
        ImportBatchEntity::class,
        OutboxEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(BallastTypeConverters::class)
abstract class BallastDatabase : RoomDatabase() {
    abstract fun transactionDao(): TransactionDao
    abstract fun categoryDao(): CategoryDao
    abstract fun importBatchDao(): ImportBatchDao
    abstract fun outboxDao(): OutboxDao

    companion object {
        const val NAME = "ballast.db"
    }
}
