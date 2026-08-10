package com.ballastmoney.android.data.remote.dto

import com.ballastmoney.android.core.model.BigDecimalSerializer
import com.ballastmoney.android.core.model.InstantSerializer
import com.ballastmoney.android.data.remote.WireDaySerializer
import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/** Wire shape for `GET /api/dashboard`. */
@Serializable
data class DashboardResponseDto(
    val dashboard: DashboardDto,
    val currency: String? = null,
    val edition: String? = null,
    /** Which cards this member may draw. Saves asking three times and being refused. */
    val sections: DashboardSectionsDto = DashboardSectionsDto(),
)

@Serializable
data class DashboardSectionsDto(
    val transactions: Boolean = false,
    val invoices: Boolean = false,
    val reports: Boolean = false,
)

@Serializable
data class DashboardDto(
    @Serializable(with = BigDecimalSerializer::class)
    val monthIncome: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val monthExpenses: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val monthNet: BigDecimal = BigDecimal.ZERO,
    /**
     * Percentages, as numbers rather than money strings, and null when there is
     * no previous month to compare against — which is why they are `Double?`
     * and not `Double` with a zero default. Zero means "no change"; null means
     * "the question does not apply".
     */
    val incomeChangePct: Double? = null,
    val expensesChangePct: Double? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val totalBalance: BigDecimal = BigDecimal.ZERO,
    /**
     * The contract documents this as a fraction between 0 and 1; the server's
     * own serializer calls it a whole percent. The mapper normalises rather
     * than betting on one reading — see `DashboardMapper`.
     */
    val savingsRate: Double = 0.0,
    val transactionCount: Int = 0,
    val cash: CashPositionDto = CashPositionDto(),
    val monthlySeries: List<MonthlyPointDto> = emptyList(),
    val categoryBreakdown: List<CategoryPointDto> = emptyList(),
    val largestExpenses: List<TransactionSummaryDto> = emptyList(),
    val balanceHistory: List<BalancePointDto> = emptyList(),
    val recentTransactions: List<TransactionSummaryDto> = emptyList(),
)

@Serializable
data class CashPositionDto(
    /** `bank` or `transactions`. */
    val source: String = "transactions",
    @Serializable(with = BigDecimalSerializer::class)
    val total: BigDecimal = BigDecimal.ZERO,
    val currency: String? = null,
    /** Grouped per connection. The domain model only needs the count. */
    val banks: List<CashBankDto> = emptyList(),
    val accounts: List<CashAccountDto> = emptyList(),
    val countedAccounts: Int = 0,
    val excludedAccounts: Int = 0,
    val hasOtherCurrency: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val asOf: Instant? = null,
    /** Cash derived from transaction history, for comparison with [total]. */
    @Serializable(with = BigDecimalSerializer::class)
    val transactionBalance: BigDecimal = BigDecimal.ZERO,
)

@Serializable
data class CashBankDto(
    val connectionId: String,
    val label: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val total: BigDecimal = BigDecimal.ZERO,
    val accounts: List<CashAccountDto> = emptyList(),
)

@Serializable
data class CashAccountDto(
    val id: String,
    val connectionId: String? = null,
    val connectionLabel: String? = null,
    val label: String? = null,
    /** Nullable on the wire: a provider need not report one. */
    val currency: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal? = null,
    @Serializable(with = InstantSerializer::class)
    val balanceAt: Instant? = null,
    val includeInTotals: Boolean = true,
    val counted: Boolean = true,
    /** `counted`, `excluded`, `no-balance` or `other-currency`. */
    val reason: String? = null,
)

@Serializable
data class MonthlyPointDto(
    /**
     * A chart axis tick — `"Aug"` — not a date, and carrying no year. A client
     * that needs a real month derives it from the position in the series.
     */
    val month: String,
    @Serializable(with = BigDecimalSerializer::class)
    val income: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val expenses: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = BigDecimalSerializer::class)
    val net: BigDecimal = BigDecimal.ZERO,
)

@Serializable
data class CategoryPointDto(
    val category: String? = null,
    val color: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal = BigDecimal.ZERO,
)

/**
 * A calendar day widened to a UTC-midnight timestamp, per the contract, so
 * every date on the wire reads the same way. Parsed by taking the day part.
 */
@Serializable
data class BalancePointDto(
    @Serializable(with = WireDaySerializer::class)
    val date: LocalDate,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal = BigDecimal.ZERO,
)

/**
 * The trimmed transaction the dashboard sends. Note `category` is the category
 * *name* here, where `GET /api/transactions` sends an object — the two
 * endpoints genuinely differ and the mapper handles each separately.
 */
@Serializable
data class TransactionSummaryDto(
    val id: String,
    val type: String,
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal = BigDecimal.ZERO,
    val category: String? = null,
    val categoryColor: String? = null,
    val description: String = "",
    @Serializable(with = WireDaySerializer::class)
    val date: LocalDate,
)
