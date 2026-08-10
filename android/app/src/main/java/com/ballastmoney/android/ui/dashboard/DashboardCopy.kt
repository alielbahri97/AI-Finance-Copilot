package com.ballastmoney.android.ui.dashboard

import com.ballastmoney.android.core.model.CashPosition
import com.ballastmoney.android.core.model.CashSource
import com.ballastmoney.android.core.model.ExclusionReason
import com.ballastmoney.android.core.model.Profile
import com.ballastmoney.android.core.model.WorkspaceType
import kotlin.math.roundToInt

/**
 * Every string the dashboard renders, plus the small amount of arithmetic that
 * decides which string to use.
 *
 * These live apart from the composables for two reasons. The copy is a direct
 * port of `src/app/(dashboard)/dashboard/page.tsx` and its children, so having
 * it in one file makes a side-by-side diff against the web app possible. And
 * the pluralisation and hint-selection rules are the only logic in this package
 * worth unit-testing, which is awkward when it is buried inside a `@Composable`.
 *
 * Strings are Kotlin constants rather than `strings.xml` entries because the web
 * app is English-only today; when localisation lands, this file is the single
 * place that has to change.
 */
object DashboardCopy {

    // --- Header --------------------------------------------------------------

    const val HOME_GREETING = "Home"
    const val PERSONAL_SUBTITLE = "Your money at a glance."
    const val BUSINESS_SUBTITLE = "Your business money at a glance."
    const val ADD_TRANSACTION = "Add transaction"
    const val IMPORT = "Import"
    const val REFRESH = "Refresh"

    // --- Getting started -----------------------------------------------------

    const val GETTING_STARTED_TITLE = "Let's get your money in"
    const val GETTING_STARTED_PERSONAL =
        "Once a few transactions are here, this page shows what you have, " +
            "what came in and went out, and where it goes."
    const val GETTING_STARTED_BUSINESS =
        "Once a few transactions are here, this page shows cash position, " +
            "monthly income and expenses, and where money goes by category."
    const val TILE_BANK_TITLE = "Connect a bank"
    const val TILE_BANK_BODY =
        "Read-only access. Balances and transactions keep updating on their own."
    const val TILE_STATEMENT_TITLE = "Upload a statement"
    const val TILE_STATEMENT_BODY =
        "Drop a CSV, Excel, PDF or MT940 export. Duplicates are skipped."
    const val TILE_MANUAL_TITLE = "Add one manually"
    const val TILE_MANUAL_BODY = "Type a single income or expense to see how it reads."
    const val GETTING_STARTED_NO_PERMISSION =
        "Someone with permission to edit transactions has to connect a bank " +
            "or import a statement first."
    const val HOW_IMPORTING_WORKS = "How importing works"

    // --- Stats ---------------------------------------------------------------

    const val TOTAL_CASH = "Total cash"
    const val INCOME_THIS_MONTH = "Income this month"
    const val EXPENSES_THIS_MONTH = "Expenses this month"
    const val SAVINGS_RATE = "Savings rate"
    const val VS_PREVIOUS_MONTH = "vs. previous month"
    const val SAVINGS_RATE_HINT = "Share of this month's income kept"
    const val MONEY_IN_THIS_MONTH = "Money in this month"
    const val MONEY_OUT_THIS_MONTH = "Money out this month"
    const val LEFT_TO_SPEND = "Left to spend"
    const val OVER_BUDGET = "Over budget"
    const val KEPT_THIS_MONTH = "Kept this month"
    const val KEPT_THIS_MONTH_HINT = "Share of this month's income you didn't spend"
    const val SHOW_BREAKDOWN = "Show breakdown"
    const val HIDE_BREAKDOWN = "Hide breakdown"
    const val CASH_FROM_TRANSACTIONS = "Across all recorded transactions"
    const val CASH_NO_BANK_BALANCES =
        "No bank balances yet \u2014 from your recorded transactions"

    // --- Business banners ----------------------------------------------------

    const val FORECAST_TITLE = "Cash flow forecast"
    const val FORECAST_SUBTITLE = "Runway, projections and what-if assumptions"
    const val CASH_RUNWAY = "Cash runway"
    const val RUNWAY_INFINITE = "\u221E (cash-flow positive)"
    const val PROJECTED_BALANCE_30D = "Projected balance in 30 days"

    // --- Personal sections ---------------------------------------------------

    const val BUDGETS = "Budgets"
    const val BUDGETS_EMPTY_TITLE = "No budgets this month"
    const val BUDGETS_EMPTY_BODY =
        "Set a limit on a category or two and this card shows how much is left."
    const val BUDGETS_EMPTY_ACTION = "Set a monthly limit"
    const val UPCOMING_BILLS = "Upcoming bills"
    const val UPCOMING_BILLS_WINDOW = "Next 45 days"
    const val SAVINGS_GOALS = "Savings goals"
    const val GOALS_EMPTY_TITLE = "No goals yet"
    const val GOALS_EMPTY_BODY = "Name what you are saving for\u2026"
    const val SUBSCRIPTIONS = "Subscriptions"
    const val SUBSCRIPTIONS_EMPTY_TITLE = "Nothing recurring detected yet"
    const val SUBSCRIPTIONS_EMPTY_BODY =
        "Once the same merchant charges you on a schedule, it shows up here."
    const val NET_WORTH = "Net worth"
    const val ASSETS = "Assets"
    const val DEBTS = "Debts"
    const val CASH = "Cash"

    // --- Errors --------------------------------------------------------------

    const val ERROR_TITLE = "Couldn't load your dashboard"
    const val ERROR_RETRY_HINT = "Check your connection and try again."
    const val GENERIC_ERROR = "Something went wrong."

    /** `"Hi, {firstName}"` when there is a first name, `"Home"` otherwise. */
    fun greetingFor(profile: Profile): String {
        val first = profile.firstName?.trim()
        return if (first.isNullOrEmpty()) HOME_GREETING else "Hi, $first"
    }

    fun subtitleFor(edition: WorkspaceType): String = when (edition) {
        WorkspaceType.PERSONAL -> PERSONAL_SUBTITLE
        WorkspaceType.BUSINESS -> BUSINESS_SUBTITLE
    }

    fun gettingStartedDescription(edition: WorkspaceType): String = when (edition) {
        WorkspaceType.PERSONAL -> GETTING_STARTED_PERSONAL
        WorkspaceType.BUSINESS -> GETTING_STARTED_BUSINESS
    }

    /**
     * The line under the headline cash figure.
     *
     * Three cases, exactly as the web app: a transaction-derived total with no
     * accounts at all, a transaction-derived total for someone who *has*
     * connected a bank but has no balances back from it yet, and a real
     * bank-sourced total that says how many accounts it covers.
     */
    fun cashHint(cash: CashPosition): String = when {
        cash.source == CashSource.TRANSACTIONS && cash.accounts.isEmpty() -> CASH_FROM_TRANSACTIONS
        cash.source == CashSource.TRANSACTIONS -> CASH_NO_BANK_BALANCES
        else -> buildString {
            append(pluralize(cash.countedAccounts, "account"))
            append(" at ")
            append(pluralize(cash.banks, "bank"))
            if (cash.excludedAccounts > 0) {
                append(", ")
                append(cash.excludedAccounts)
                append(" excluded")
            }
        }
    }

    /** The note beside an account whose balance is not in the headline number. */
    fun exclusionNote(reason: ExclusionReason?, currency: String): String? = when (reason) {
        ExclusionReason.EXCLUDED -> "not in totals"
        ExclusionReason.NO_BALANCE -> "no balance yet"
        ExclusionReason.OTHER_CURRENCY -> "held in $currency"
        null -> null
    }

    fun invoiceAlertTitle(count: Int): String =
        if (count == 1) "1 invoice needs attention" else "$count invoices need attention"

    /** Null runway means the business is cash-flow positive, so it never ends. */
    fun runwayLabel(runwayMonths: Double?): String =
        if (runwayMonths == null) RUNWAY_INFINITE else "~${runwayMonths.roundToInt()} months"

    fun upcomingBillsDescription(total: String?): String =
        if (total == null) UPCOMING_BILLS_WINDOW else "$total due in the next 45 days"

    fun allUpcomingBillsLink(count: Int): String = "All $count upcoming bills"

    fun trendLabel(percent: Int): String =
        if (percent >= 0) "+$percent%" else "\u2212${-percent}%"

    fun percentLabel(percent: Int): String = "$percent%"

    /**
     * Share text for a donut legend row: a whole number once a slice is big
     * enough to round without lying, one decimal below that.
     */
    fun shareLabel(sharePct: Double): String =
        if (sharePct >= 10.0) {
            "${sharePct.roundToInt()}%"
        } else {
            val tenths = (sharePct * 10).roundToInt() / 10.0
            "$tenths%"
        }

    /** `"1 account"` / `"3 accounts"`. Only handles the regular `+s` plural. */
    fun pluralize(count: Int, singular: String): String =
        if (count == 1) "1 $singular" else "$count ${singular}s"
}
