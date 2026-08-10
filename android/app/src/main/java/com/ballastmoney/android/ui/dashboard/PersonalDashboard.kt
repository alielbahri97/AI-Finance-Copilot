package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyTone
import com.ballastmoney.android.ui.chart.BalanceHistoryChart
import com.ballastmoney.android.ui.chart.LargestExpensesCard
import com.ballastmoney.android.ui.chart.MonthlyCashflowChart
import com.ballastmoney.android.ui.chart.RecentTransactionsCard
import com.ballastmoney.android.ui.chart.SpendingByCategoryChart
import java.math.BigDecimal

/**
 * The Personal edition body.
 *
 * Personal and Business share every chart and differ in everything else. The
 * split is not cosmetic: a person wants to know what is left to spend, a
 * business wants to know how much cash it has and how long it lasts, and those
 * are different first questions. Hence two stat rows and two section lists over
 * one payload.
 */
fun LazyListScope.personalDashboardSections(
    state: DashboardUiState.Ready,
    showCashBreakdown: Boolean,
    onToggleCashBreakdown: () -> Unit,
    onViewAllTransactions: () -> Unit,
    onSetBudget: () -> Unit,
) {
    val snapshot = state.snapshot
    val canSeeTransactions = state.can(Permission.VIEW_TRANSACTIONS)

    if (canSeeTransactions) {
        item(key = "personal-stats") {
            PersonalStatRow(
                state = state,
                showCashBreakdown = showCashBreakdown,
                onToggleCashBreakdown = onToggleCashBreakdown,
            )
        }
        item(key = "budgets") {
            BudgetsCard(
                budgets = snapshot.budgets,
                formatter = state.formatter,
                onSetBudget = onSetBudget,
            )
        }
        item(key = "upcoming-bills") {
            UpcomingBillsCard(
                bills = snapshot.upcomingBills,
                formatter = state.formatter,
                onViewAll = onViewAllTransactions,
            )
        }
        if (state.limits.goalsEnabled) {
            item(key = "savings-goals") {
                SavingsGoalsCard(goals = snapshot.goals, formatter = state.formatter)
            }
        }
        if (state.limits.subscriptionInsightsEnabled) {
            item(key = "subscriptions") {
                SubscriptionsCard(
                    subscriptions = snapshot.subscriptions,
                    formatter = state.formatter,
                )
            }
        }
        val netWorth = snapshot.netWorth
        if (state.limits.netWorthEnabled && netWorth != null && netWorth.holdingCount > 0) {
            item(key = "net-worth") {
                NetWorthCard(netWorth = netWorth, formatter = state.formatter)
            }
        }
    }

    if (state.canSeeCharts) {
        // See the note in `businessDashboardSections`: an item that composes to
        // nothing still occupies a slot in the list's spacing.
        if (snapshot.monthly.isNotEmpty()) {
            item(key = "monthly-cashflow") {
                MonthlyCashflowChart(
                    points = snapshot.monthly,
                    formatter = state.formatter,
                    edition = WorkspaceType.PERSONAL,
                )
            }
        }
        item(key = "balance-history") {
            BalanceHistoryChart(
                history = snapshot.balanceHistory,
                accounts = snapshot.cash.accounts,
                source = snapshot.cash.source,
                formatter = state.formatter,
                edition = WorkspaceType.PERSONAL,
            )
        }
        item(key = "spending-by-category") {
            SpendingByCategoryChart(
                slices = snapshot.spendingByCategory,
                formatter = state.formatter,
            )
        }
        item(key = "largest-expenses") {
            LargestExpensesCard(
                expenses = snapshot.largestExpenses,
                formatter = state.formatter,
            )
        }
    }

    if (canSeeTransactions) {
        item(key = "recent-transactions") {
            RecentTransactionsCard(
                transactions = snapshot.recentTransactions,
                formatter = state.formatter,
                onViewAllTransactions = onViewAllTransactions,
            )
        }
    }
}

/**
 * Four cards, but which four depends on whether budgets exist.
 *
 * Someone who has set budgets is asking "how much is left"; someone who has not
 * is asking "how much do I have". Leading with the wrong one of those is the
 * difference between a useful screen and a spreadsheet.
 */
@Composable
fun PersonalStatRow(
    state: DashboardUiState.Ready,
    showCashBreakdown: Boolean,
    onToggleCashBreakdown: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = state.snapshot
    val cards = if (snapshot.budgets.isEmpty()) {
        listOf<@Composable (Modifier) -> Unit>(
            { cardModifier ->
                TotalCashCard(
                    cash = snapshot.cash,
                    formatter = state.formatter,
                    expanded = showCashBreakdown,
                    onToggleExpanded = onToggleCashBreakdown,
                    modifier = cardModifier,
                    size = MoneySize.HERO,
                )
            },
            { cardModifier -> MoneyInCard(state, cardModifier) },
            { cardModifier -> MoneyOutCard(state, cardModifier) },
            { cardModifier ->
                TextStatCard(
                    label = DashboardCopy.KEPT_THIS_MONTH,
                    value = DashboardCopy.percentLabel(snapshot.savingsRatePct),
                    modifier = cardModifier,
                    hint = DashboardCopy.KEPT_THIS_MONTH_HINT,
                )
            },
        )
    } else {
        val budgeted = snapshot.budgets.fold(BigDecimal.ZERO) { sum, b -> sum.add(b.limit) }
        val remaining = snapshot.budgets.fold(BigDecimal.ZERO) { sum, b -> sum.add(b.remaining) }
        val isOver = remaining.signum() < 0
        listOf<@Composable (Modifier) -> Unit>(
            { cardModifier ->
                MoneyStatCard(
                    label = if (isOver) DashboardCopy.OVER_BUDGET else DashboardCopy.LEFT_TO_SPEND,
                    // The sign lives in the label, so the figure is the
                    // magnitude either way — "Over budget −£40" reads as a
                    // double negative.
                    amount = remaining.abs(),
                    formatter = state.formatter,
                    modifier = cardModifier,
                    hint = "of ${state.formatter.format(budgeted)} budgeted this month",
                    size = MoneySize.HERO,
                    tone = if (isOver) MoneyTone.DESTRUCTIVE else MoneyTone.DEFAULT,
                )
            },
            { cardModifier -> MoneyInCard(state, cardModifier) },
            { cardModifier -> MoneyOutCard(state, cardModifier) },
            { cardModifier ->
                TotalCashCard(
                    cash = snapshot.cash,
                    formatter = state.formatter,
                    expanded = showCashBreakdown,
                    onToggleExpanded = onToggleCashBreakdown,
                    modifier = cardModifier,
                    size = MoneySize.MD,
                )
            },
        )
    }
    StatCardGrid(cards = cards, modifier = modifier)
}

@Composable
private fun MoneyInCard(state: DashboardUiState.Ready, modifier: Modifier) {
    MoneyStatCard(
        label = DashboardCopy.MONEY_IN_THIS_MONTH,
        amount = state.snapshot.monthIncome,
        formatter = state.formatter,
        modifier = modifier,
    )
}

@Composable
private fun MoneyOutCard(state: DashboardUiState.Ready, modifier: Modifier) {
    MoneyStatCard(
        label = DashboardCopy.MONEY_OUT_THIS_MONTH,
        amount = state.snapshot.monthExpenses,
        formatter = state.formatter,
        modifier = modifier,
    )
}