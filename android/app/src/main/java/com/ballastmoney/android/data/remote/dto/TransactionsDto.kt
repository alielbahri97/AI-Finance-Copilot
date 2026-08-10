package com.ballastmoney.android.data.remote.dto

import com.ballastmoney.android.core.model.BigDecimalSerializer
import com.ballastmoney.android.core.model.InstantSerializer
import com.ballastmoney.android.data.remote.WireDaySerializer
import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * Wire shape for `GET /api/transactions`.
 *
 * Two fields are deliberately not per-page and the paging layer has to respect
 * that:
 *
 *  - [totals] aggregates the **whole filtered set**, because "how much did
 *    groceries cost me" is the question a filter is asked.
 *  - [batches] lists every import in the workspace regardless of the filter,
 *    because it populates the batch filter itself and would otherwise vanish
 *    the moment it was used.
 *
 * [page] is the page actually served: asking for page 40 of a three-page set
 * returns page 3, not an empty list. A `RemoteMediator` must therefore compare
 * what it asked for with what it got rather than assuming they match, or it will
 * page forever against a clamped tail.
 */
@Serializable
data class TransactionsResponseDto(
    val transactions: List<TransactionDto> = emptyList(),
    val currency: String? = null,
    val page: Int = 1,
    val pageSize: Int = 50,
    val pageCount: Int = 1,
    val totalCount: Int = 0,
    val sort: String? = null,
    val dir: String? = null,
    val totals: TransactionTotalsDto = TransactionTotalsDto(),
    val batches: List<ImportBatchDto> = emptyList(),
)

@Serializable
data class TransactionDto(
    val id: String,
    /** `INCOME` or `EXPENSE`. There is no transfer type. */
    val type: String,
    /** Always positive; the sign is carried by [type]. */
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal = BigDecimal.ZERO,
    val currency: String? = null,
    /** Null when uncategorized. An object here, unlike the dashboard's string. */
    val category: TransactionCategoryDto? = null,
    val description: String = "",
    val counterparty: String? = null,
    /** A calendar day at UTC midnight. */
    @Serializable(with = WireDaySerializer::class)
    val date: LocalDate,
    /** A real instant, unlike [date]. */
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
    val importBatchId: String? = null,
)

@Serializable
data class TransactionCategoryDto(
    val id: String,
    val name: String,
    val color: String? = null,
)

@Serializable
data class TransactionTotalsDto(
    @Serializable(with = BigDecimalSerializer::class)
    val income: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val expenses: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val net: BigDecimal = BigDecimal.ZERO,
)

@Serializable
data class ImportBatchDto(
    val id: String,
    val fileName: String = "",
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
    val transactionCount: Int = 0,
)
