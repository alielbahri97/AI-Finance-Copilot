package com.ballastmoney.android.core.model

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * Shape of `GET /api/dashboard`.
 *
 * One payload serves both editions. The edition-specific blocks are nullable
 * or empty rather than being split into two response types, because the web
 * app computes them from the same query and the client already knows which
 * edition it is rendering.
 */
@Serializable
data class DashboardSnapshot(
    val currency: String,
    val transactionCount: Int,
    val cash: CashPosition,

    @Serializable(with = BigDecimalSerializer::class)
    val monthIncome: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val monthExpenses: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val monthNet: BigDecimal,
    /** Share of this month's income kept, already rounded to a whole percent. */
    val savingsRatePct: Int,
    /**
     * Month-on-month change. Null when the previous month was zero, which is
     * how the web app suppresses a meaningless "infinite increase" badge.
     */
    val incomeChangePct: Int? = null,
    val expensesChangePct: Int? = null,

    /** Always six entries, oldest first, zero-filled where there is no data. */
    val monthly: List<MonthlyPoint> = emptyList(),
    val balanceHistory: List<BalancePoint> = emptyList(),
    /** Top eight expense categories over six months, largest first. */
    val spendingByCategory: List<CategorySlice> = emptyList(),
    val largestExpenses: List<Transaction> = emptyList(),
    val recentTransactions: List<Transaction> = emptyList(),

    // Personal edition blocks.
    val budgets: List<BudgetProgress> = emptyList(),
    val upcomingBills: List<UpcomingBill> = emptyList(),
    val goals: List<SavingsGoal> = emptyList(),
    val subscriptions: List<SubscriptionInsight> = emptyList(),
    val netWorth: NetWorthSummary? = null,

    // Business edition blocks.
    val invoiceAlert: InvoiceAlert? = null,
    val forecast: ForecastTeaser? = null,
) {
    /**
     * Drives the "getting started" state. Matches the web app's
     * `hasNoFinancialData`: a connected bank with no transactions yet still
     * counts as having data, so the checklist does not reappear after someone
     * has already done the hard part.
     */
    val hasNoFinancialData: Boolean
        get() = transactionCount == 0 && cash.accounts.isEmpty()
}

@Serializable
data class CashPosition(
    @Serializable(with = BigDecimalSerializer::class)
    val total: BigDecimal,
    val source: CashSource,
    val accounts: List<CashAccount> = emptyList(),
    val countedAccounts: Int = 0,
    val excludedAccounts: Int = 0,
    val banks: Int = 0,
)

@Serializable
enum class CashSource {
    /** Summed from real bank balances. */
    BANK,

    /** Derived by running the transaction history forward. */
    TRANSACTIONS,
}

@Serializable
data class CashAccount(
    val id: String,
    val name: String,
    val mask: String? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal? = null,
    val currency: String,
    val includeInTotals: Boolean = true,
    val exclusionReason: ExclusionReason? = null,
)

/** Why an account's balance is not part of the headline cash number. */
@Serializable
enum class ExclusionReason {
    /** The user turned "In totals" off. */
    EXCLUDED,

    /** The provider has not reported a balance yet. */
    NO_BALANCE,

    /** Held in a currency other than the workspace currency. */
    OTHER_CURRENCY,
}

@Serializable
data class MonthlyPoint(
    /** Short English month name, as the web app renders it. */
    val label: String,
    @Serializable(with = BigDecimalSerializer::class)
    val income: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val expenses: BigDecimal,
    /**
     * Signed net. Unlike income and expenses this *includes* transfer
     * categories, because transfers cancel out across accounts and excluding
     * them would make the net line disagree with the balance line.
     */
    @Serializable(with = BigDecimalSerializer::class)
    val net: BigDecimal,
)

@Serializable
data class BalancePoint(
    @Serializable(with = LocalDateSerializer::class)
    val date: LocalDate,
    @Serializable(with = BigDecimalSerializer::class)
    val balance: BigDecimal,
)

@Serializable
data class CategorySlice(
    val name: String,
    /** Hex from the category row; the palette lives in the database. */
    val color: String,
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal,
    val sharePct: Double,
)

@Serializable
data class BudgetProgress(
    val id: String,
    val categoryName: String,
    val categoryColor: String,
    @Serializable(with = BigDecimalSerializer::class)
    val limit: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val spent: BigDecimal,
) {
    val remaining: BigDecimal get() = limit.subtract(spent)
    val isOverspent: Boolean get() = remaining.signum() < 0
}

@Serializable
data class UpcomingBill(
    val id: String,
    val description: String,
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal,
    @Serializable(with = LocalDateSerializer::class)
    val dueDate: LocalDate,
    val categoryName: String? = null,
    val categoryColor: String? = null,
)

@Serializable
data class SavingsGoal(
    val id: String,
    val name: String,
    @Serializable(with = BigDecimalSerializer::class)
    val target: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val saved: BigDecimal,
    @Serializable(with = LocalDateSerializer::class)
    val targetDate: LocalDate? = null,
)

@Serializable
data class SubscriptionInsight(
    val id: String,
    val merchant: String,
    @Serializable(with = BigDecimalSerializer::class)
    val amount: BigDecimal,
    val cadence: String,
    @Serializable(with = LocalDateSerializer::class)
    val nextChargeDate: LocalDate? = null,
)

@Serializable
data class NetWorthSummary(
    @Serializable(with = BigDecimalSerializer::class)
    val net: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val assets: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val debts: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val cash: BigDecimal,
    val holdingCount: Int = 0,
)

@Serializable
data class InvoiceAlert(
    val dueCount: Int,
    val overdueCount: Int,
    @Serializable(with = BigDecimalSerializer::class)
    val overdueTotal: BigDecimal,
    @Serializable(with = BigDecimalSerializer::class)
    val dueSoonTotal: BigDecimal,
)

@Serializable
data class ForecastTeaser(
    /** Null means cash-flow positive, rendered as an infinity runway. */
    val runwayMonths: Double? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val projectedBalance30d: BigDecimal,
    @Serializable(with = InstantSerializer::class)
    val generatedAt: Instant? = null,
)
