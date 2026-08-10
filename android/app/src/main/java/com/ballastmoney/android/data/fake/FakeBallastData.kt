package com.ballastmoney.android.data.fake

import com.ballastmoney.android.core.model.BalancePoint
import com.ballastmoney.android.core.model.BudgetProgress
import com.ballastmoney.android.core.model.CashAccount
import com.ballastmoney.android.core.model.CashPosition
import com.ballastmoney.android.core.model.CashSource
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.CategorySlice
import com.ballastmoney.android.core.model.ConnectedAccount
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.EditionFeature
import com.ballastmoney.android.core.model.Editions
import com.ballastmoney.android.core.model.Entitlements
import com.ballastmoney.android.core.model.ExclusionReason
import com.ballastmoney.android.core.model.ForecastTeaser
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.InvoiceAlert
import com.ballastmoney.android.core.model.MonthlyPoint
import com.ballastmoney.android.core.model.NetWorthSummary
import com.ballastmoney.android.core.model.OnboardingState
import com.ballastmoney.android.core.model.PlanId
import com.ballastmoney.android.core.model.PlanLimits
import com.ballastmoney.android.core.model.Profile
import com.ballastmoney.android.core.model.ProviderCapability
import com.ballastmoney.android.core.model.ProviderCategory
import com.ballastmoney.android.core.model.RolePermissions
import com.ballastmoney.android.core.model.SavingsGoal
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.core.model.SubscriptionInsight
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.core.model.UpcomingBill
import com.ballastmoney.android.core.model.Workspace
import com.ballastmoney.android.core.model.WorkspaceRole
import com.ballastmoney.android.core.model.WorkspaceSummary
import com.ballastmoney.android.core.model.WorkspaceType
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale
import kotlin.random.Random

/**
 * The mock dataset every screen renders against until the JSON API exists.
 *
 * It is generated from a fixed seed on purpose. Deterministic data means a
 * screenshot or a UI test asserting "expenses this month reads €3,412.87" keeps
 * passing tomorrow, and two developers looking at the same screen see the same
 * numbers. Everything is derived from one transaction list so the dashboard
 * totals, the charts and the transactions screen genuinely agree with each
 * other — mock data that contradicts itself hides real layout problems.
 */
object FakeBallastData {

    const val BUSINESS_WORKSPACE_ID = "ws_business"
    const val PERSONAL_WORKSPACE_ID = "ws_personal"

    private const val SEED = 20260810
    private val zone = ZoneOffset.UTC

    /** Fixed "today" so generated history and month boundaries never drift. */
    val today: LocalDate = LocalDate.of(2026, 8, 10)

    val profile = Profile(
        id = "user_1",
        email = "ali@northwind.example",
        firstName = "Ali",
        lastName = "El Bahri",
        isAdmin = false,
    )

    val businessWorkspace = Workspace(
        id = BUSINESS_WORKSPACE_ID,
        name = "Northwind Studio",
        type = WorkspaceType.BUSINESS,
        currency = "EUR",
        role = WorkspaceRole.OWNER,
    )

    val personalWorkspace = Workspace(
        id = PERSONAL_WORKSPACE_ID,
        name = "Personal",
        type = WorkspaceType.PERSONAL,
        currency = "EUR",
        role = WorkspaceRole.OWNER,
    )

    val workspaceSummaries = listOf(
        WorkspaceSummary(businessWorkspace.id, businessWorkspace.name, businessWorkspace.type),
        WorkspaceSummary(personalWorkspace.id, personalWorkspace.name, personalWorkspace.type),
    )

    private val businessLimits = PlanLimits(
        csvImportsPerMonth = null,
        rowsPerImport = 20_000,
        aiMessagesPerMonth = 1_000,
        aiCategorizationPerMonth = 5_000,
        invoiceExtractionsPerMonth = 500,
        dunningEnabled = true,
        exportsEnabled = true,
        assumptionsEnabled = true,
        maxScenarios = 10,
        integrationsEnabled = true,
        bankConnections = null,
        seats = 10,
        crossEditionEnabled = true,
    )

    private val personalLimits = PlanLimits(
        csvImportsPerMonth = 10,
        rowsPerImport = 5_000,
        aiMessagesPerMonth = 200,
        aiCategorizationPerMonth = 1_000,
        exportsEnabled = true,
        integrationsEnabled = true,
        bankConnections = 3,
        goalsEnabled = true,
        netWorthEnabled = true,
        subscriptionInsightsEnabled = true,
        seats = 1,
    )

    fun entitlementsFor(type: WorkspaceType): Entitlements = when (type) {
        WorkspaceType.BUSINESS -> Entitlements(PlanId.BUSINESS, limits = businessLimits)
        WorkspaceType.PERSONAL -> Entitlements(PlanId.PLUS, limits = personalLimits)
    }

    fun workspaceFor(workspaceId: String): Workspace =
        if (workspaceId == PERSONAL_WORKSPACE_ID) personalWorkspace else businessWorkspace

    fun sessionFor(workspaceId: String): SessionBootstrap {
        val workspace = workspaceFor(workspaceId)
        return SessionBootstrap(
            profile = profile,
            workspaces = workspaceSummaries,
            currentWorkspace = workspace,
            // Resolved the same way the server does: role defaults, then the
            // edition narrowing that strips invoices and team from Personal.
            permissions = Editions.applyEditionPermissions(
                workspace.type,
                RolePermissions.forRole(workspace.role),
            ),
            entitlements = entitlementsFor(workspace.type),
            onboarding = OnboardingState(
                completed = true,
                hasBankConnection = true,
                hasTransactions = true,
            ),
            unreadNotifications = 3,
        )
    }

    // ---------------------------------------------------------------- categories

    /** The web app's `DEFAULT_CATEGORIES` seed, colours included. */
    val categories: List<Category> = listOf(
        Category("cat_salary", "Salary", TransactionType.INCOME, "#10b981"),
        Category("cat_freelance", "Freelance", TransactionType.INCOME, "#14b8a6"),
        Category("cat_investments", "Investments", TransactionType.INCOME, "#06b6d4"),
        Category("cat_other_income", "Other income", TransactionType.INCOME, "#64748b"),
        Category("cat_transfer_in", "Transfer in", TransactionType.INCOME, "#64748b"),
        Category("cat_housing", "Housing", TransactionType.EXPENSE, "#6366f1"),
        Category("cat_groceries", "Groceries", TransactionType.EXPENSE, "#f59e0b"),
        Category("cat_transport", "Transport", TransactionType.EXPENSE, "#3b82f6"),
        Category("cat_dining", "Dining", TransactionType.EXPENSE, "#ef4444"),
        Category("cat_entertainment", "Entertainment", TransactionType.EXPENSE, "#ec4899"),
        Category("cat_health", "Health", TransactionType.EXPENSE, "#22c55e"),
        Category("cat_shopping", "Shopping", TransactionType.EXPENSE, "#a855f7"),
        Category("cat_utilities", "Utilities", TransactionType.EXPENSE, "#0ea5e9"),
        Category("cat_travel", "Travel", TransactionType.EXPENSE, "#f97316"),
        Category("cat_subscriptions", "Subscriptions", TransactionType.EXPENSE, "#8b5cf6"),
        Category("cat_education", "Education", TransactionType.EXPENSE, "#84cc16"),
        Category("cat_transfer", "Transfer", TransactionType.EXPENSE, "#94a3b8"),
        Category("cat_other", "Other", TransactionType.EXPENSE, "#64748b"),
    )

    private val transferCategoryIds = setOf("cat_transfer", "cat_transfer_in")

    val importBatches: List<ImportBatch> = listOf(
        ImportBatch("batch_1", "ing-statement-jul-2026.csv", instantOf(today.minusDays(12))),
        ImportBatch("batch_2", "revolut-2026-q2.xlsx", instantOf(today.minusDays(48))),
        ImportBatch("batch_3", "kbc-mt940-jun.txt", instantOf(today.minusDays(70))),
    )

    // -------------------------------------------------------------- transactions

    private data class Merchant(
        val description: String,
        val categoryId: String?,
        val counterparty: String?,
        val min: Int,
        val max: Int,
    )

    private val expenseMerchants = listOf(
        Merchant("Monthly rent", "cat_housing", "Vandenberghe Properties", 1_250_00, 1_250_00),
        Merchant("Colruyt groceries", "cat_groceries", "Colruyt", 32_00, 118_00),
        Merchant("Delhaize", "cat_groceries", "Delhaize", 18_00, 74_00),
        Merchant("NMBS season ticket", "cat_transport", "NMBS", 62_00, 62_00),
        Merchant("Shell fuel", "cat_transport", "Shell", 45_00, 92_00),
        Merchant("Lunch at Kaffee Anvers", "cat_dining", null, 12_00, 38_00),
        Merchant("Dinner out", "cat_dining", null, 28_00, 96_00),
        Merchant("Cinema tickets", "cat_entertainment", "Kinepolis", 14_00, 42_00),
        Merchant("Pharmacy", "cat_health", null, 9_00, 64_00),
        Merchant("Decathlon", "cat_shopping", "Decathlon", 22_00, 180_00),
        Merchant("Engie electricity", "cat_utilities", "Engie", 78_00, 142_00),
        Merchant("Proximus internet", "cat_utilities", "Proximus", 55_00, 55_00),
        Merchant("Brussels Airlines", "cat_travel", "Brussels Airlines", 120_00, 640_00),
        Merchant("Spotify Premium", "cat_subscriptions", "Spotify", 11_99, 11_99),
        Merchant("Adobe Creative Cloud", "cat_subscriptions", "Adobe", 61_49, 61_49),
        Merchant("Figma Organization", "cat_subscriptions", "Figma", 45_00, 45_00),
        Merchant("Notion Business", "cat_subscriptions", "Notion", 18_00, 18_00),
        // Deliberately uncategorised: the transactions screen highlights these
        // and the dashboard shows them as "Uncategorized", so the states get
        // exercised without anyone having to edit the fixtures.
        Merchant("SumUp payout fee", null, "SumUp", 4_50, 32_00),
        Merchant("BNP Paribas Fortis charge", null, "BNP Paribas Fortis", 3_50, 19_00),
        Merchant("Bolt ride", null, "Bolt", 8_00, 34_00),
        Merchant("Transfer to savings", "cat_transfer", null, 200_00, 600_00),
    )

    private val incomeMerchants = listOf(
        Merchant("Client retainer — Meridian", "cat_freelance", "Meridian BV", 2_400_00, 2_400_00),
        Merchant("Project invoice — Alder & Co", "cat_freelance", "Alder & Co", 850_00, 3_200_00),
        Merchant("Monthly salary", "cat_salary", "Northwind Studio", 3_150_00, 3_150_00),
        Merchant("Dividend payout", "cat_investments", null, 45_00, 320_00),
        Merchant("Transfer from current", "cat_transfer_in", null, 200_00, 600_00),
    )

    /** Six months of history ending at [today], newest first. */
    val transactions: List<Transaction> by lazy { generateTransactions() }

    private fun generateTransactions(): List<Transaction> {
        val random = Random(SEED)
        val categoriesById = categories.associateBy { it.id }
        val result = mutableListOf<Transaction>()
        var sequence = 0

        val firstMonth = YearMonth.from(today).minusMonths(5)
        for (monthOffset in 0..5) {
            val month = firstMonth.plusMonths(monthOffset.toLong())
            val lastDay = if (month == YearMonth.from(today)) today.dayOfMonth else month.lengthOfMonth()

            // Two salary-like income events and a handful of invoices per month.
            val incomeCount = random.nextInt(2, 5)
            repeat(incomeCount) {
                val merchant = incomeMerchants.random(random)
                val day = random.nextInt(1, lastDay + 1)
                result += buildTransaction(
                    sequence = sequence++,
                    type = TransactionType.INCOME,
                    merchant = merchant,
                    date = month.atDay(day),
                    random = random,
                    categoriesById = categoriesById,
                )
            }

            val expenseCount = random.nextInt(16, 26)
            repeat(expenseCount) {
                val merchant = expenseMerchants.random(random)
                val day = random.nextInt(1, lastDay + 1)
                result += buildTransaction(
                    sequence = sequence++,
                    type = TransactionType.EXPENSE,
                    merchant = merchant,
                    date = month.atDay(day),
                    random = random,
                    categoriesById = categoriesById,
                )
            }
        }

        return result.sortedWith(
            compareByDescending<Transaction> { it.date }.thenByDescending { it.id },
        )
    }

    private fun buildTransaction(
        sequence: Int,
        type: TransactionType,
        merchant: Merchant,
        date: LocalDate,
        random: Random,
        categoriesById: Map<String, Category>,
    ): Transaction {
        val minor = if (merchant.min == merchant.max) {
            merchant.min
        } else {
            random.nextInt(merchant.min, merchant.max + 1)
        }
        val category = merchant.categoryId?.let(categoriesById::get)
        return Transaction(
            id = "tx_%04d".format(sequence),
            type = type,
            amount = BigDecimal.valueOf(minor.toLong(), 2),
            description = merchant.description,
            date = instantOf(date),
            categoryId = category?.id,
            categoryName = category?.name,
            categoryColor = category?.color,
            counterparty = merchant.counterparty,
            importBatchId = if (random.nextInt(3) == 0) importBatches.random(random).id else null,
        )
    }

    private fun instantOf(date: LocalDate): Instant =
        date.atTime(hourFor(date), 0).toInstant(zone)

    /** Spreads times across the working day without needing another Random. */
    private fun hourFor(date: LocalDate): Int = 8 + (date.dayOfYear % 11)

    // ----------------------------------------------------------------- dashboard

    fun dashboardFor(workspaceId: String): DashboardSnapshot {
        val workspace = workspaceFor(workspaceId)
        val personal = workspace.type == WorkspaceType.PERSONAL
        val currentMonth = YearMonth.from(today)
        val previousMonth = currentMonth.minusMonths(1)

        val monthIncome = sumFor(currentMonth, TransactionType.INCOME, excludeTransfers = true)
        val monthExpenses = sumFor(currentMonth, TransactionType.EXPENSE, excludeTransfers = true)
        val previousIncome = sumFor(previousMonth, TransactionType.INCOME, excludeTransfers = true)
        val previousExpenses = sumFor(previousMonth, TransactionType.EXPENSE, excludeTransfers = true)
        val monthNet = monthIncome.subtract(monthExpenses)

        return DashboardSnapshot(
            currency = workspace.currency,
            transactionCount = transactions.size,
            cash = cashPosition(workspace.currency),
            monthIncome = monthIncome,
            monthExpenses = monthExpenses,
            monthNet = monthNet,
            savingsRatePct = if (monthIncome.signum() > 0) {
                monthNet.multiply(BigDecimal(100))
                    .divide(monthIncome, 0, RoundingMode.HALF_UP)
                    .toInt()
            } else {
                0
            },
            incomeChangePct = percentChange(monthIncome, previousIncome),
            expensesChangePct = percentChange(monthExpenses, previousExpenses),
            monthly = monthlySeries(),
            balanceHistory = balanceHistory(),
            spendingByCategory = spendingByCategory(),
            largestExpenses = transactions
                .filter { it.type == TransactionType.EXPENSE }
                .sortedByDescending { it.amount }
                .take(5),
            recentTransactions = transactions.take(8),
            budgets = if (personal) budgets else emptyList(),
            upcomingBills = if (personal) upcomingBills else emptyList(),
            goals = if (personal) goals else emptyList(),
            subscriptions = if (personal) subscriptions else emptyList(),
            netWorth = if (personal) netWorth else null,
            invoiceAlert = if (personal) null else InvoiceAlert(
                dueCount = 3,
                overdueCount = 1,
                overdueTotal = BigDecimal("1840.00"),
                dueSoonTotal = BigDecimal("4275.50"),
            ),
            forecast = if (personal) null else ForecastTeaser(
                runwayMonths = 7.4,
                projectedBalance30d = BigDecimal("21480.65"),
                generatedAt = instantOf(today),
            ),
        )
    }

    private fun sumFor(
        month: YearMonth,
        type: TransactionType,
        excludeTransfers: Boolean,
    ): BigDecimal = transactions
        .asSequence()
        .filter { it.type == type }
        .filter { YearMonth.from(it.date.atZone(zone)) == month }
        .filterNot { excludeTransfers && it.categoryId in transferCategoryIds }
        .map { it.amount }
        .fold(BigDecimal.ZERO, BigDecimal::add)

    private fun percentChange(current: BigDecimal, previous: BigDecimal): Int? {
        if (previous.signum() == 0) return null
        return current.subtract(previous)
            .multiply(BigDecimal(100))
            .divide(previous, 0, RoundingMode.HALF_UP)
            .toInt()
    }

    private fun monthlySeries(): List<MonthlyPoint> {
        val firstMonth = YearMonth.from(today).minusMonths(5)
        return (0..5).map { offset ->
            val month = firstMonth.plusMonths(offset.toLong())
            val income = sumFor(month, TransactionType.INCOME, excludeTransfers = true)
            val expenses = sumFor(month, TransactionType.EXPENSE, excludeTransfers = true)
            // Net includes transfers, which cancel out across accounts; the web
            // app does the same so the net line agrees with the balance line.
            val netIncome = sumFor(month, TransactionType.INCOME, excludeTransfers = false)
            val netExpenses = sumFor(month, TransactionType.EXPENSE, excludeTransfers = false)
            MonthlyPoint(
                label = month.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH),
                income = income,
                expenses = expenses,
                net = netIncome.subtract(netExpenses),
            )
        }
    }

    private fun balanceHistory(): List<BalancePoint> {
        val start = today.minusMonths(5).withDayOfMonth(1)
        val byDate = transactions.groupBy { it.date.atZone(zone).toLocalDate() }
        var running = BigDecimal("4200.00")
        val points = mutableListOf<BalancePoint>()
        var cursor = start
        while (!cursor.isAfter(today)) {
            byDate[cursor]?.forEach { transaction ->
                running = when (transaction.type) {
                    TransactionType.INCOME -> running.add(transaction.amount)
                    TransactionType.EXPENSE -> running.subtract(transaction.amount)
                }
            }
            // One point per week plus the final day keeps the series readable on
            // a phone-width chart without losing the shape.
            if (cursor.dayOfWeek.value == 1 || cursor == today) {
                points += BalancePoint(cursor, running)
            }
            cursor = cursor.plusDays(1)
        }
        return points
    }

    private fun spendingByCategory(): List<CategorySlice> {
        val expenses = transactions
            .filter { it.type == TransactionType.EXPENSE }
            .filterNot { it.categoryId in transferCategoryIds }
        val grouped = expenses.groupBy { it.categoryName ?: "Uncategorized" }
        val totals = grouped.mapValues { (_, rows) ->
            rows.map { it.amount }.fold(BigDecimal.ZERO, BigDecimal::add)
        }
        val overall = totals.values.fold(BigDecimal.ZERO, BigDecimal::add)
        return totals.entries
            .sortedByDescending { it.value }
            .take(8)
            .map { (name, amount) ->
                CategorySlice(
                    name = name,
                    color = grouped.getValue(name).firstNotNullOfOrNull { it.categoryColor }
                        ?: UNCATEGORIZED_COLOR,
                    amount = amount,
                    sharePct = if (overall.signum() == 0) {
                        0.0
                    } else {
                        amount.multiply(BigDecimal(100))
                            .divide(overall, 2, RoundingMode.HALF_UP)
                            .toDouble()
                    },
                )
            }
    }

    private fun cashPosition(currency: String) = CashPosition(
        total = BigDecimal("18942.37"),
        source = CashSource.BANK,
        accounts = listOf(
            CashAccount("acc_1", "ING Business current", "••4821", BigDecimal("12480.11"), currency),
            CashAccount("acc_2", "ING Savings", "••9930", BigDecimal("6462.26"), currency),
            CashAccount(
                id = "acc_3",
                name = "Revolut USD",
                mask = "••2214",
                balance = BigDecimal("1180.40"),
                currency = "USD",
                includeInTotals = true,
                exclusionReason = ExclusionReason.OTHER_CURRENCY,
            ),
            CashAccount(
                id = "acc_4",
                name = "Old KBC current",
                mask = "••1002",
                balance = BigDecimal("240.00"),
                currency = currency,
                includeInTotals = false,
                exclusionReason = ExclusionReason.EXCLUDED,
            ),
        ),
        countedAccounts = 2,
        excludedAccounts = 2,
        banks = 3,
    )

    private val budgets = listOf(
        BudgetProgress("bud_1", "Groceries", "#f59e0b", BigDecimal("450.00"), BigDecimal("312.48")),
        BudgetProgress("bud_2", "Dining", "#ef4444", BigDecimal("200.00"), BigDecimal("214.90")),
        BudgetProgress("bud_3", "Transport", "#3b82f6", BigDecimal("180.00"), BigDecimal("124.00")),
        BudgetProgress("bud_4", "Entertainment", "#ec4899", BigDecimal("120.00"), BigDecimal("38.00")),
    )

    private val upcomingBills = listOf(
        UpcomingBill("bill_1", "Monthly rent", BigDecimal("1250.00"), today.plusDays(4), "Housing", "#6366f1"),
        UpcomingBill("bill_2", "Proximus internet", BigDecimal("55.00"), today.plusDays(9), "Utilities", "#0ea5e9"),
        UpcomingBill("bill_3", "Engie electricity", BigDecimal("112.40"), today.plusDays(15), "Utilities", "#0ea5e9"),
        UpcomingBill("bill_4", "Adobe Creative Cloud", BigDecimal("61.49"), today.plusDays(21), "Subscriptions", "#8b5cf6"),
        UpcomingBill("bill_5", "Car insurance", BigDecimal("284.00"), today.plusDays(33), "Transport", "#3b82f6"),
    )

    private val goals = listOf(
        SavingsGoal("goal_1", "Emergency fund", BigDecimal("10000.00"), BigDecimal("6450.00"), today.plusMonths(8)),
        SavingsGoal("goal_2", "Japan trip", BigDecimal("4000.00"), BigDecimal("1180.00"), today.plusMonths(14)),
    )

    private val subscriptions = listOf(
        SubscriptionInsight("sub_1", "Adobe", BigDecimal("61.49"), "Monthly", today.plusDays(21)),
        SubscriptionInsight("sub_2", "Spotify", BigDecimal("11.99"), "Monthly", today.plusDays(6)),
        SubscriptionInsight("sub_3", "Figma", BigDecimal("45.00"), "Monthly", today.plusDays(12)),
        SubscriptionInsight("sub_4", "Notion", BigDecimal("18.00"), "Monthly", today.plusDays(27)),
    )

    private val netWorth = NetWorthSummary(
        net = BigDecimal("142380.00"),
        assets = BigDecimal("214500.00"),
        debts = BigDecimal("90062.00"),
        cash = BigDecimal("18942.37"),
        holdingCount = 5,
    )

    // -------------------------------------------------------------- integrations

    val providers: List<IntegrationProvider> = listOf(
        IntegrationProvider(
            id = "gocardless",
            displayName = "GoCardless Bank Account Data",
            category = ProviderCategory.BANKING,
            capabilities = setOf(ProviderCapability.TRANSACTIONS),
            syncIntervalHours = 6,
            multiInstance = true,
        ),
        IntegrationProvider(
            id = "plaid",
            displayName = "Plaid",
            category = ProviderCategory.BANKING,
            capabilities = setOf(ProviderCapability.TRANSACTIONS),
            syncIntervalHours = 6,
            multiInstance = true,
        ),
        IntegrationProvider(
            id = "tink",
            displayName = "Tink",
            category = ProviderCategory.BANKING,
            capabilities = setOf(ProviderCapability.TRANSACTIONS),
            syncIntervalHours = 6,
            // Not configured on this server, so the screen shows "Needs setup"
            // and the administrator guide rather than a button that fails.
            configured = false,
        ),
        IntegrationProvider(
            id = "quickbooks",
            displayName = "QuickBooks",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
            syncIntervalHours = 6,
        ),
        IntegrationProvider(
            id = "xero",
            displayName = "Xero",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
            syncIntervalHours = 6,
        ),
        IntegrationProvider(
            id = "exact",
            displayName = "Exact Online",
            category = ProviderCategory.ACCOUNTING,
            capabilities = setOf(ProviderCapability.INVOICES),
            syncIntervalHours = 6,
        ),
        IntegrationProvider(
            id = "gmail",
            displayName = "Gmail",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.EMAIL),
            syncIntervalHours = 6,
        ),
        IntegrationProvider(
            id = "outlook",
            displayName = "Outlook",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.EMAIL),
            syncIntervalHours = 6,
        ),
        IntegrationProvider(
            id = "google-calendar",
            displayName = "Google Calendar",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.CALENDAR),
            syncIntervalHours = 24,
        ),
        IntegrationProvider(
            id = "slack",
            displayName = "Slack",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.NOTIFICATIONS),
            syncIntervalHours = null,
        ),
        IntegrationProvider(
            id = "teams",
            displayName = "Microsoft Teams",
            category = ProviderCategory.PRODUCTIVITY,
            capabilities = setOf(ProviderCapability.NOTIFICATIONS),
            syncIntervalHours = null,
        ),
    )

    /**
     * One healthy connection, one whose consent is nearly up, and one in error —
     * so the screen's three interesting states are all visible without editing
     * fixtures.
     */
    val connections: List<IntegrationConnection> = listOf(
        IntegrationConnection(
            id = "conn_ing",
            providerId = "gocardless",
            title = "ING Belgium",
            status = ConnectionStatus.CONNECTED,
            lastSyncAt = instantOf(today).minusSeconds(3_600),
            consentExpiresAt = today.plusDays(62),
            accounts = listOf(
                ConnectedAccount("acc_1", "ING Business current", "••4821", BigDecimal("12480.11"), "EUR"),
                ConnectedAccount("acc_2", "ING Savings", "••9930", BigDecimal("6462.26"), "EUR"),
            ),
        ),
        IntegrationConnection(
            id = "conn_kbc",
            providerId = "gocardless",
            title = "KBC",
            status = ConnectionStatus.CONNECTED,
            lastSyncAt = instantOf(today).minusSeconds(26_000),
            consentExpiresAt = today.plusDays(9),
            accounts = listOf(
                ConnectedAccount(
                    id = "acc_4",
                    name = "Old KBC current",
                    mask = "••1002",
                    balance = BigDecimal("240.00"),
                    currency = "EUR",
                    includeInTotals = false,
                ),
            ),
        ),
        IntegrationConnection(
            id = "conn_revolut",
            providerId = "plaid",
            title = "Revolut",
            status = ConnectionStatus.EXPIRED,
            lastSyncAt = instantOf(today.minusDays(9)),
            lastError = "ITEM_LOGIN_REQUIRED",
            accounts = listOf(
                ConnectedAccount("acc_3", "Revolut USD", "••2214", BigDecimal("1180.40"), "USD"),
            ),
        ),
    )

    fun integrationsFor(workspaceId: String): IntegrationsOverview {
        val workspace = workspaceFor(workspaceId)
        val visibleProviders = providers.filter { provider ->
            // Accounting providers only exist in the Business edition, the same
            // filter `editionAllowsProvider` applies on the web.
            provider.category != ProviderCategory.ACCOUNTING ||
                Editions.hasFeature(workspace.type, EditionFeature.ACCOUNTING)
        }
        return IntegrationsOverview(
            providers = visibleProviders,
            connections = connections,
            lockedReason = null,
        )
    }

    /** The web app's fallback colour for anything uncategorised. */
    const val UNCATEGORIZED_COLOR = "#94a3b8"
}
