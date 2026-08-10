package com.ballastmoney.android.ui.dashboard

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.BalancePoint
import com.ballastmoney.android.core.model.BudgetProgress
import com.ballastmoney.android.core.model.CashAccount
import com.ballastmoney.android.core.model.CashPosition
import com.ballastmoney.android.core.model.CashSource
import com.ballastmoney.android.core.model.CategorySlice
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.ExclusionReason
import com.ballastmoney.android.core.model.ForecastTeaser
import com.ballastmoney.android.core.model.InvoiceAlert
import com.ballastmoney.android.core.model.MonthlyPoint
import com.ballastmoney.android.core.model.NetWorthSummary
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.PlanLimits
import com.ballastmoney.android.core.model.SavingsGoal
import com.ballastmoney.android.core.model.SubscriptionInsight
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.core.model.UpcomingBill
import com.ballastmoney.android.core.model.WorkspaceType
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * Fixtures for the previews in this package and in `ui/chart`.
 *
 * Deliberately not in `data/`: nothing outside these previews should be able to
 * reach a fake dashboard, and a fixture that ships in the same package as the
 * real repositories eventually gets used by one of them. Every value is fixed —
 * no `now()`, no randomness — so a preview looks the same today as it will next
 * year, and a screenshot diff means something.
 *
 * The numbers are chosen to exercise the awkward cases rather than to look tidy:
 * an excluded account, an account with no balance, an account in another
 * currency, a budget that is overspent, an invoice alert, a positive-runway
 * forecast, and one category small enough to need a decimal place in its share.
 */
object DashboardPreviewData {

    val formatter: MoneyFormatter = MoneyFormatter("EUR")

    val allPermissions: Set<Permission> = setOf(
        Permission.VIEW_TRANSACTIONS,
        Permission.EDIT_TRANSACTIONS,
        Permission.VIEW_INVOICES,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_DATA,
    )

    /** A VIEWER: can read the numbers, cannot import or add anything. */
    val readOnlyPermissions: Set<Permission> = setOf(
        Permission.VIEW_TRANSACTIONS,
        Permission.VIEW_REPORTS,
    )

    val paidLimits: PlanLimits = PlanLimits(
        exportsEnabled = true,
        integrationsEnabled = true,
        goalsEnabled = true,
        netWorthEnabled = true,
        subscriptionInsightsEnabled = true,
    )

    val freeLimits: PlanLimits = PlanLimits()

    // --- Business ------------------------------------------------------------

    private val businessAccounts = listOf(
        CashAccount(
            id = "acc-current",
            name = "Business current",
            mask = "4821",
            balance = BigDecimal("61230.40"),
            currency = "EUR",
        ),
        CashAccount(
            id = "acc-savings",
            name = "Reserve savings",
            mask = "1180",
            balance = BigDecimal("23020.35"),
            currency = "EUR",
        ),
        CashAccount(
            id = "acc-old",
            name = "Old current account",
            mask = "9902",
            balance = BigDecimal("4120.00"),
            currency = "EUR",
            includeInTotals = false,
            exclusionReason = ExclusionReason.EXCLUDED,
        ),
        CashAccount(
            id = "acc-usd",
            name = "USD holding",
            mask = "7714",
            balance = BigDecimal("8800.00"),
            currency = "USD",
            includeInTotals = false,
            exclusionReason = ExclusionReason.OTHER_CURRENCY,
        ),
        CashAccount(
            id = "acc-pending",
            name = "New savings pot",
            mask = "5510",
            balance = null,
            currency = "EUR",
            includeInTotals = false,
            exclusionReason = ExclusionReason.NO_BALANCE,
        ),
    )

    val businessSnapshot: DashboardSnapshot = DashboardSnapshot(
        currency = "EUR",
        transactionCount = 428,
        cash = CashPosition(
            total = BigDecimal("84250.75"),
            source = CashSource.BANK,
            accounts = businessAccounts,
            countedAccounts = 2,
            excludedAccounts = 3,
            banks = 2,
        ),
        monthIncome = BigDecimal("48200.00"),
        monthExpenses = BigDecimal("31450.50"),
        monthNet = BigDecimal("16749.50"),
        savingsRatePct = 35,
        incomeChangePct = 12,
        expensesChangePct = 8,
        monthly = monthlyPoints(),
        balanceHistory = balanceHistory(),
        spendingByCategory = businessCategories(),
        largestExpenses = largestExpenses(),
        recentTransactions = recentTransactions(),
        invoiceAlert = InvoiceAlert(
            dueCount = 2,
            overdueCount = 1,
            overdueTotal = BigDecimal("3400.00"),
            dueSoonTotal = BigDecimal("7250.00"),
        ),
        forecast = ForecastTeaser(
            runwayMonths = 14.4,
            projectedBalance30d = BigDecimal("91200.00"),
            generatedAt = Instant.parse("2026-08-10T06:00:00Z"),
        ),
    )

    // --- Personal ------------------------------------------------------------

    val personalSnapshot: DashboardSnapshot = DashboardSnapshot(
        currency = "EUR",
        transactionCount = 212,
        cash = CashPosition(
            total = BigDecimal("12480.20"),
            source = CashSource.TRANSACTIONS,
        ),
        monthIncome = BigDecimal("4200.00"),
        monthExpenses = BigDecimal("2890.40"),
        monthNet = BigDecimal("1309.60"),
        savingsRatePct = 31,
        incomeChangePct = 3,
        expensesChangePct = -6,
        monthly = monthlyPoints(scale = "0.08"),
        balanceHistory = balanceHistory(scale = "0.15"),
        spendingByCategory = personalCategories(),
        largestExpenses = largestExpenses(scale = "0.10"),
        recentTransactions = recentTransactions(scale = "0.10"),
        budgets = budgets(),
        upcomingBills = upcomingBills(),
        goals = goals(),
        subscriptions = subscriptions(),
        netWorth = NetWorthSummary(
            net = BigDecimal("48210.00"),
            assets = BigDecimal("72000.00"),
            debts = BigDecimal("23790.00"),
            cash = BigDecimal("12480.20"),
            holdingCount = 5,
        ),
    )

    /** Budgets removed, so the Personal stat row leads with cash instead. */
    val personalSnapshotWithoutBudgets: DashboardSnapshot =
        personalSnapshot.copy(budgets = emptyList())

    /** Every budget blown, so the hero card has to flip to "Over budget". */
    val personalSnapshotOverBudget: DashboardSnapshot = personalSnapshot.copy(
        budgets = personalSnapshot.budgets.map { budget ->
            budget.copy(spent = budget.limit.multiply(BigDecimal("1.35")))
        },
    )

    /** No transactions and no connected accounts: the getting-started state. */
    val emptySnapshot: DashboardSnapshot = DashboardSnapshot(
        currency = "EUR",
        transactionCount = 0,
        cash = CashPosition(total = BigDecimal.ZERO, source = CashSource.TRANSACTIONS),
        monthIncome = BigDecimal.ZERO,
        monthExpenses = BigDecimal.ZERO,
        monthNet = BigDecimal.ZERO,
        savingsRatePct = 0,
    )

    // --- Ready states --------------------------------------------------------

    val businessReady: DashboardUiState.Ready = DashboardUiState.Ready(
        edition = WorkspaceType.BUSINESS,
        greeting = "Hi, Ada",
        subtitle = DashboardCopy.BUSINESS_SUBTITLE,
        snapshot = businessSnapshot,
        formatter = formatter,
        permissions = allPermissions,
        limits = paidLimits,
    )

    val personalReady: DashboardUiState.Ready = DashboardUiState.Ready(
        edition = WorkspaceType.PERSONAL,
        greeting = "Hi, Ada",
        subtitle = DashboardCopy.PERSONAL_SUBTITLE,
        snapshot = personalSnapshot,
        formatter = formatter,
        permissions = allPermissions,
        limits = paidLimits,
    )

    val gettingStartedReady: DashboardUiState.Ready = businessReady.copy(
        snapshot = emptySnapshot,
    )

    val gettingStartedReadOnlyReady: DashboardUiState.Ready = DashboardUiState.Ready(
        edition = WorkspaceType.PERSONAL,
        greeting = DashboardCopy.HOME_GREETING,
        subtitle = DashboardCopy.PERSONAL_SUBTITLE,
        snapshot = emptySnapshot,
        formatter = formatter,
        permissions = readOnlyPermissions,
        limits = freeLimits,
    )

    // --- Builders ------------------------------------------------------------

    private fun monthlyPoints(scale: String = "1.00"): List<MonthlyPoint> {
        val factor = BigDecimal(scale)
        val raw = listOf(
            Triple("Mar", "39100.00", "28400.00"),
            Triple("Apr", "42600.00", "30100.00"),
            Triple("May", "37400.00", "33900.00"),
            Triple("Jun", "45800.00", "29750.00"),
            Triple("Jul", "51200.00", "34600.00"),
            Triple("Aug", "48200.00", "31450.50"),
        )
        return raw.map { (label, income, expenses) ->
            val scaledIncome = BigDecimal(income).multiply(factor)
            val scaledExpenses = BigDecimal(expenses).multiply(factor)
            MonthlyPoint(
                label = label,
                income = scaledIncome,
                expenses = scaledExpenses,
                net = scaledIncome.subtract(scaledExpenses),
            )
        }
    }

    private fun balanceHistory(scale: String = "1.00"): List<BalancePoint> {
        val factor = BigDecimal(scale)
        val raw = listOf(
            "2026-03-31" to "58400.00",
            "2026-04-30" to "62900.00",
            "2026-05-31" to "59700.00",
            "2026-06-30" to "71300.00",
            "2026-07-31" to "79800.00",
            "2026-08-10" to "84250.75",
        )
        return raw.map { (date, balance) ->
            BalancePoint(
                date = LocalDate.parse(date),
                balance = BigDecimal(balance).multiply(factor),
            )
        }
    }

    private fun businessCategories(): List<CategorySlice> = listOf(
        CategorySlice("Payroll", "#6366f1", BigDecimal("94200.00"), 41.8),
        CategorySlice("Software", "#0ea5e9", BigDecimal("38650.00"), 17.1),
        CategorySlice("Office & rent", "#22c55e", BigDecimal("31200.00"), 13.8),
        CategorySlice("Travel", "#f59e0b", BigDecimal("22400.00"), 9.9),
        CategorySlice("Professional fees", "#a855f7", BigDecimal("18900.00"), 8.4),
        // Deliberately under 10% and not a round number, so the legend has to
        // render a decimal share.
        CategorySlice("Bank charges", "bad-hex", BigDecimal("1940.00"), 0.86),
    )

    private fun personalCategories(): List<CategorySlice> = listOf(
        CategorySlice("Groceries", "#22c55e", BigDecimal("4120.00"), 28.4),
        CategorySlice("Rent", "#6366f1", BigDecimal("3900.00"), 26.9),
        CategorySlice("Eating out", "#f59e0b", BigDecimal("2210.00"), 15.2),
        CategorySlice("Transport", "#0ea5e9", BigDecimal("1480.00"), 10.2),
        // No `#`, to prove the parser copes.
        CategorySlice("Subscriptions", "a855f7", BigDecimal("980.00"), 6.8),
        CategorySlice("Uncategorized", UNCATEGORIZED_HEX, BigDecimal("640.00"), 4.4),
    )

    private fun largestExpenses(scale: String = "1.00"): List<Transaction> {
        val factor = BigDecimal(scale)
        val raw = listOf(
            Triple("Q3 payroll run", "18400.00", "Payroll" to "#6366f1"),
            Triple("Annual insurance", "9250.00", "Professional fees" to "#a855f7"),
            Triple("Office rent \u2014 August", "6100.00", "Office & rent" to "#22c55e"),
            Triple("Conference stand", "4780.00", "Travel" to "#f59e0b"),
            Triple("Laptop refresh", "3990.00", "Software" to "#0ea5e9"),
        )
        return raw.mapIndexed { index, (description, amount, category) ->
            Transaction(
                id = "expense-$index",
                type = TransactionType.EXPENSE,
                amount = BigDecimal(amount).multiply(factor),
                description = description,
                date = Instant.parse("2026-08-0${index + 1}T09:30:00Z"),
                categoryId = "cat-$index",
                categoryName = category.first,
                categoryColor = category.second,
            )
        }
    }

    private fun recentTransactions(scale: String = "1.00"): List<Transaction> {
        val factor = BigDecimal(scale)
        val raw = listOf(
            RecentFixture("Invoice 2026-118 paid", "12400.00", TransactionType.INCOME, "Sales", "#22c55e"),
            RecentFixture("AWS", "1840.55", TransactionType.EXPENSE, "Software", "#0ea5e9"),
            RecentFixture("Stripe payout", "6210.00", TransactionType.INCOME, "Sales", "#22c55e"),
            RecentFixture("Office cleaning", "320.00", TransactionType.EXPENSE, null, null),
            RecentFixture("Train to Berlin", "189.40", TransactionType.EXPENSE, "Travel", "#f59e0b"),
            RecentFixture("Invoice 2026-117 paid", "8900.00", TransactionType.INCOME, "Sales", "#22c55e"),
            RecentFixture("Figma", "45.00", TransactionType.EXPENSE, "Software", "#0ea5e9"),
            RecentFixture("Accountant retainer", "1250.00", TransactionType.EXPENSE, "Professional fees", "#a855f7"),
        )
        return raw.mapIndexed { index, fixture ->
            Transaction(
                id = "recent-$index",
                type = fixture.type,
                amount = BigDecimal(fixture.amount).multiply(factor),
                description = fixture.description,
                date = Instant.parse("2026-08-0${(index % 9) + 1}T14:05:00Z"),
                categoryId = fixture.categoryName?.let { "cat-${it.lowercase()}" },
                categoryName = fixture.categoryName,
                categoryColor = fixture.categoryColor,
            )
        }
    }

    private data class RecentFixture(
        val description: String,
        val amount: String,
        val type: TransactionType,
        val categoryName: String?,
        val categoryColor: String?,
    )

    private fun budgets(): List<BudgetProgress> = listOf(
        BudgetProgress(
            id = "b-groceries",
            categoryName = "Groceries",
            categoryColor = "#22c55e",
            limit = BigDecimal("600.00"),
            spent = BigDecimal("412.75"),
        ),
        BudgetProgress(
            id = "b-eating",
            categoryName = "Eating out",
            categoryColor = "#f59e0b",
            limit = BigDecimal("200.00"),
            // Nearly gone, so this bar has to come out amber.
            spent = BigDecimal("178.40"),
        ),
        BudgetProgress(
            id = "b-transport",
            categoryName = "Transport",
            categoryColor = "#0ea5e9",
            limit = BigDecimal("120.00"),
            // Overspent, so this bar has to come out red.
            spent = BigDecimal("164.10"),
        ),
        BudgetProgress(
            id = "b-fun",
            categoryName = "Fun",
            categoryColor = "#a855f7",
            limit = BigDecimal("150.00"),
            spent = BigDecimal("42.00"),
        ),
    )

    private fun upcomingBills(): List<UpcomingBill> = listOf(
        UpcomingBill("bill-1", "Rent", BigDecimal("1250.00"), LocalDate.parse("2026-08-31"), "Housing", "#6366f1"),
        UpcomingBill("bill-2", "Electricity", BigDecimal("94.20"), LocalDate.parse("2026-08-18"), "Utilities", "#0ea5e9"),
        UpcomingBill("bill-3", "Mobile", BigDecimal("29.00"), LocalDate.parse("2026-08-20"), "Utilities", "#0ea5e9"),
        UpcomingBill("bill-4", "Gym", BigDecimal("39.00"), LocalDate.parse("2026-08-24"), "Health", "#22c55e"),
        UpcomingBill("bill-5", "Car insurance", BigDecimal("212.00"), LocalDate.parse("2026-09-02"), "Transport", "#f59e0b"),
        UpcomingBill("bill-6", "Internet", BigDecimal("55.00"), LocalDate.parse("2026-09-05"), "Utilities", "#0ea5e9"),
        // Seven and eight exist only so the "All 8 upcoming bills" link appears.
        UpcomingBill("bill-7", "Water", BigDecimal("31.50"), LocalDate.parse("2026-09-12"), null, null),
        UpcomingBill("bill-8", "Streaming bundle", BigDecimal("24.99"), LocalDate.parse("2026-09-14"), null, null),
    )

    private fun goals(): List<SavingsGoal> = listOf(
        SavingsGoal(
            id = "goal-house",
            name = "House deposit",
            target = BigDecimal("30000.00"),
            saved = BigDecimal("11400.00"),
            targetDate = LocalDate.parse("2028-06-01"),
        ),
        SavingsGoal(
            id = "goal-buffer",
            name = "Rainy day buffer",
            target = BigDecimal("6000.00"),
            saved = BigDecimal("5250.00"),
        ),
    )

    private fun subscriptions(): List<SubscriptionInsight> = listOf(
        SubscriptionInsight(
            id = "sub-1",
            merchant = "Streaming bundle",
            amount = BigDecimal("24.99"),
            cadence = "Monthly",
            nextChargeDate = LocalDate.parse("2026-08-19"),
        ),
        SubscriptionInsight(
            id = "sub-2",
            merchant = "Cloud storage",
            amount = BigDecimal("9.99"),
            cadence = "Monthly",
            nextChargeDate = LocalDate.parse("2026-08-22"),
        ),
        SubscriptionInsight(
            id = "sub-3",
            merchant = "Cycling club",
            amount = BigDecimal("120.00"),
            cadence = "Yearly",
            nextChargeDate = LocalDate.parse("2027-01-04"),
        ),
    )

    /** The web app's uncategorised grey, repeated here so fixtures stay self-contained. */
    private const val UNCATEGORIZED_HEX = "#94A3B8"
}
