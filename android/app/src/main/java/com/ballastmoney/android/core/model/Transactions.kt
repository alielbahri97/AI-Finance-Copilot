package com.ballastmoney.android.core.model

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * There are only two transaction types. The web app has no TRANSFER type;
 * internal transfers are modelled as a pair of ordinary rows in the "Transfer"
 * and "Transfer in" categories, and the dashboard excludes those categories
 * from income and expense totals so a transfer does not inflate both sides.
 */
@Serializable
enum class TransactionType {
    INCOME,
    EXPENSE,
}

@Serializable
data class Transaction(
    val id: String,
    val type: TransactionType,
    /** Always positive. The sign is carried by [type], as on the web. */
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal,
    val description: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val categoryId: String? = null,
    val categoryName: String? = null,
    /** Hex string as stored on the category row, e.g. `#6366f1`. */
    val categoryColor: String? = null,
    val counterparty: String? = null,
    val importBatchId: String? = null,
    val invoiceId: String? = null,
    val invoiceVendor: String? = null,
) {
    val isUncategorized: Boolean get() = categoryId == null
}

@Serializable
data class Category(
    val id: String,
    val name: String,
    val type: TransactionType,
    val color: String,
)

@Serializable
data class ImportBatch(
    val id: String,
    val fileName: String,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant,
)

@Serializable
enum class TransactionSortKey {
    DATE,
    DESCRIPTION,
    CATEGORY,
    AMOUNT,
    ;

    /**
     * Per-column default direction, matching `SORT_DEFAULT_DIRECTION` on the
     * web: dates and amounts start at the largest, text starts at A.
     */
    val defaultDirection: SortDirection
        get() = when (this) {
            DATE, AMOUNT -> SortDirection.DESC
            DESCRIPTION, CATEGORY -> SortDirection.ASC
        }
}

@Serializable
enum class SortDirection {
    ASC,
    DESC,
    ;

    fun toggled(): SortDirection = if (this == ASC) DESC else ASC
}

/**
 * Every filter `GET /api/transactions` accepts. Held as one value so it can be
 * a Paging key, a cache key and a piece of saved UI state without three
 * parallel representations drifting apart.
 *
 * [categoryId] uses the sentinel [UNCATEGORIZED] rather than null-means-any,
 * because "no category" is itself a filter the toolbar offers.
 */
@Serializable
data class TransactionQuery(
    val search: String = "",
    val type: TransactionType? = null,
    val categoryId: String? = null,
    val importBatchId: String? = null,
    @Serializable(with = LocalDateSerializer::class)
    val from: LocalDate? = null,
    @Serializable(with = LocalDateSerializer::class)
    val to: LocalDate? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val minAmount: BigDecimal? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val maxAmount: BigDecimal? = null,
    val sort: TransactionSortKey = TransactionSortKey.DATE,
    val direction: SortDirection = SortDirection.DESC,
    val pageSize: Int = DEFAULT_PAGE_SIZE,
) {
    val hasActiveFilters: Boolean
        get() = search.isNotBlank() ||
            type != null ||
            categoryId != null ||
            importBatchId != null ||
            from != null ||
            to != null ||
            minAmount != null ||
            maxAmount != null

    /** True when the range is inverted, which can never match anything. */
    val hasInvalidRange: Boolean
        get() = from != null && to != null && to.isBefore(from)

    fun cleared(): TransactionQuery = TransactionQuery(sort = sort, direction = direction, pageSize = pageSize)

    companion object {
        const val UNCATEGORIZED = "uncategorized"

        /** The web app's default; 25 and 100 are the other offered sizes. */
        const val DEFAULT_PAGE_SIZE = 50
        val PAGE_SIZE_OPTIONS = listOf(25, 50, 100)
    }
}

/**
 * Totals for the whole filtered set, not just the loaded page. The server
 * computes these because the client only ever holds a window of the results.
 */
@Serializable
data class TransactionAggregates(
    @Serializable(with = BigDecimalSerializer::class)
    val income: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val expenses: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val net: BigDecimal,
    val totalCount: Int,
)

@Serializable
data class TransactionPage(
    val items: List<Transaction>,
    val aggregates: TransactionAggregates,
    val page: Int,
    val pageCount: Int,
    val totalCount: Int,
)

/** What the add/edit sheet submits. */
data class TransactionDraft(
    val type: TransactionType = TransactionType.EXPENSE,
    val amount: BigDecimal,
    val date: LocalDate,
    val description: String,
    val categoryId: String? = null,
    val counterparty: String? = null,
)
