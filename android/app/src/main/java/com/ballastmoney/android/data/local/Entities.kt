package com.ballastmoney.android.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import java.math.BigDecimal
import java.time.Instant

/**
 * Cached transaction.
 *
 * SQLite has no decimal type, so the amount is stored as a whole number of
 * minor units rather than as a REAL. The server's columns are
 * `Decimal(12,2)` and `Decimal(14,2)`, so two decimal places is exact and
 * `BigDecimal.valueOf(minor, 2)` round-trips without loss. Storing it as TEXT
 * would preserve the scale too, but then SQLite could not order or range-filter
 * on amount, which the transactions list needs.
 */
@Entity(
    tableName = "transactions",
    indices = [
        Index(value = ["workspaceId", "date"]),
        Index(value = ["workspaceId", "categoryId"]),
    ],
)
data class TransactionEntity(
    @PrimaryKey val id: String,
    val workspaceId: String,
    val type: TransactionType,
    val amountMinor: Long,
    val description: String,
    val dateEpochMillis: Long,
    val categoryId: String?,
    val categoryName: String?,
    val categoryColor: String?,
    val counterparty: String?,
    val importBatchId: String?,
    val invoiceId: String?,
    val invoiceVendor: String?,
) {
    fun toDomain(): Transaction = Transaction(
        id = id,
        type = type,
        amount = BigDecimal.valueOf(amountMinor, MINOR_UNIT_SCALE),
        description = description,
        date = Instant.ofEpochMilli(dateEpochMillis),
        categoryId = categoryId,
        categoryName = categoryName,
        categoryColor = categoryColor,
        counterparty = counterparty,
        importBatchId = importBatchId,
        invoiceId = invoiceId,
        invoiceVendor = invoiceVendor,
    )

    companion object {
        const val MINOR_UNIT_SCALE = 2

        fun fromDomain(workspaceId: String, transaction: Transaction): TransactionEntity =
            TransactionEntity(
                id = transaction.id,
                workspaceId = workspaceId,
                type = transaction.type,
                amountMinor = transaction.amount
                    .setScale(MINOR_UNIT_SCALE, java.math.RoundingMode.UNNECESSARY)
                    .unscaledValue()
                    .toLong(),
                description = transaction.description,
                dateEpochMillis = transaction.date.toEpochMilli(),
                categoryId = transaction.categoryId,
                categoryName = transaction.categoryName,
                categoryColor = transaction.categoryColor,
                counterparty = transaction.counterparty,
                importBatchId = transaction.importBatchId,
                invoiceId = transaction.invoiceId,
                invoiceVendor = transaction.invoiceVendor,
            )
    }
}

/**
 * Server-defined ordering for one query.
 *
 * The transactions endpoint sorts and filters server-side, so the client cannot
 * reproduce the order from the rows alone — two rows with the same date fall
 * back to `createdAt`, which is not exposed. This table records "for query K,
 * position N is transaction X", which lets the Paging source replay the exact
 * order the server returned while the transaction rows themselves stay shared
 * and deduplicated.
 */
@Entity(
    tableName = "transaction_pages",
    primaryKeys = ["queryKey", "position"],
    indices = [Index(value = ["transactionId"])],
)
data class TransactionPageEntity(
    val queryKey: String,
    val position: Int,
    val transactionId: String,
)

/**
 * Paging bookkeeping per query: where the next page starts and whether the
 * server has run out of rows. Offset paging rather than cursor paging because
 * that is what the endpoint offers.
 */
@Entity(tableName = "transaction_remote_keys")
data class TransactionRemoteKeyEntity(
    @PrimaryKey val queryKey: String,
    val nextOffset: Int,
    val endOfPaginationReached: Boolean,
    val lastRefreshEpochMillis: Long,
)

/**
 * Totals for a whole filtered set, cached alongside its query. Kept separate
 * from the paged rows because the server computes it over every match, not just
 * the rows this client has loaded.
 */
@Entity(tableName = "transaction_aggregates")
data class TransactionAggregatesEntity(
    @PrimaryKey val queryKey: String,
    val incomeMinor: Long,
    val expensesMinor: Long,
    val netMinor: Long,
    val totalCount: Int,
)

@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey val id: String,
    val workspaceId: String,
    val name: String,
    val type: TransactionType,
    val color: String,
)

@Entity(tableName = "import_batches")
data class ImportBatchEntity(
    @PrimaryKey val id: String,
    val workspaceId: String,
    val fileName: String,
    val createdAtEpochMillis: Long,
)

/**
 * Queued local mutation, for optimistic writes.
 *
 * Nothing enqueues into this table yet — the write endpoints do not exist. It
 * is defined now because retrofitting an outbox later means rewriting every
 * write path: the shape of a mutation (an id generated on the device, a JSON
 * payload, an attempt count, a last error) has to be decided before the first
 * optimistic write, not after.
 *
 * The intended flow is: apply the change to Room immediately so the UI updates,
 * insert a row here, and have a worker drain it, deleting rows that succeed and
 * surfacing rows that exhaust their retries.
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey val id: String,
    val workspaceId: String,
    val kind: OutboxKind,
    /** Serialised request body; shape depends on [kind]. */
    val payloadJson: String,
    val createdAtEpochMillis: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

enum class OutboxKind {
    CREATE_TRANSACTION,
    UPDATE_TRANSACTION,
    SET_TRANSACTION_CATEGORY,
    DELETE_TRANSACTIONS,
    SET_ACCOUNT_INCLUDE_IN_TOTALS,
}
