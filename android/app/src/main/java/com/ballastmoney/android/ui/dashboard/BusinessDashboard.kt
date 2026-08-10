package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.ForecastTeaser
import com.ballastmoney.android.core.model.InvoiceAlert
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.chart.BalanceHistoryChart
import com.ballastmoney.android.ui.chart.LargestExpensesCard
import com.ballastmoney.android.ui.chart.MonthlyCashflowChart
import com.ballastmoney.android.ui.chart.RecentTransactionsCard
import com.ballastmoney.android.ui.chart.SpendingByCategoryChart
import java.math.BigDecimal

/**
 * The Business edition body.
 *
 * Emitted as separate `item`s rather than one big composable so the list can
 * skip the work for cards that are off screen, and so a permission-gated card
 * costs nothing at all when it is not allowed.
 */
fun LazyListScope.businessDashboardSections(
    state: DashboardUiState.Ready,
    showCashBreakdown: Boolean,
    onToggleCashBreakdown: () -> Unit,
    onViewAllTransactions: () -> Unit,
) {
    val snapshot = state.snapshot

    if (state.can(Permission.VIEW_TRANSACTIONS)) {
        item(key = "business-stats") {
            BusinessStatRow(
                state = state,
                showCashBreakdown = showCashBreakdown,
                onToggleCashBreakdown = onToggleCashBreakdown,
            )
        }
    }

    val invoiceAlert = snapshot.invoiceAlert
    if (invoiceAlert != null && state.can(Permission.VIEW_INVOICES)) {
        item(key = "invoice-alert") {
            InvoiceAlertCard(alert = invoiceAlert, formatter = state.formatter)
        }
    }

    val forecast = snapshot.forecast
    if (forecast != null && state.can(Permission.VIEW_REPORTS)) {
        item(key = "forecast-teaser") {
            ForecastTeaserCard(forecast = forecast, formatter = state.formatter)
        }
    }

    if (state.canSeeCharts) {
        // Guarded here rather than inside the chart: an item that composes to
        // nothing still takes a slot in the list's `spacedBy` arrangement, which
        // would leave a double gap where the card should have been.
        if (snapshot.monthly.isNotEmpty()) {
            item(key = "monthly-cashflow") {
                MonthlyCashflowChart(
                    points = snapshot.monthly,
                    formatter = state.formatter,
                    edition = WorkspaceType.BUSINESS,
                )
            }
        }
        item(key = "balance-history") {
            BalanceHistoryChart(
                history = snapshot.balanceHistory,
                accounts = snapshot.cash.accounts,
                source = snapshot.cash.source,
                formatter = state.formatter,
                edition = WorkspaceType.BUSINESS,
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

    if (state.can(Permission.VIEW_TRANSACTIONS)) {
        item(key = "recent-transactions") {
            RecentTransactionsCard(
                transactions = snapshot.recentTransactions,
                formatter = state.formatter,
                onViewAllTransactions = onViewAllTransactions,
            )
        }
    }
}

@Composable
fun BusinessStatRow(
    state: DashboardUiState.Ready,
    showCashBreakdown: Boolean,
    onToggleCashBreakdown: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = state.snapshot
    StatCardGrid(
        modifier = modifier,
        cards = listOf<@Composable (Modifier) -> Unit>(
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
            { cardModifier ->
                MoneyStatCard(
                    label = DashboardCopy.INCOME_THIS_MONTH,
                    amount = snapshot.monthIncome,
                    formatter = state.formatter,
                    modifier = cardModifier,
                    hint = DashboardCopy.VS_PREVIOUS_MONTH,
                    trend = trendChangeOrNull(snapshot.incomeChangePct, increaseIsGood = true),
                )
            },
            { cardModifier ->
                MoneyStatCard(
                    label = DashboardCopy.EXPENSES_THIS_MONTH,
                    amount = snapshot.monthExpenses,
                    formatter = state.formatter,
                    modifier = cardModifier,
                    hint = DashboardCopy.VS_PREVIOUS_MONTH,
                    // Spending more is not an achievement.
                    trend = trendChangeOrNull(snapshot.expensesChangePct, increaseIsGood = false),
                )
            },
            { cardModifier ->
                TextStatCard(
                    label = DashboardCopy.SAVINGS_RATE,
                    value = DashboardCopy.percentLabel(snapshot.savingsRatePct),
                    modifier = cardModifier,
                    hint = DashboardCopy.SAVINGS_RATE_HINT,
                )
            },
        ),
    )
}

/**
 * Invoices that are overdue or nearly due.
 *
 * The web app only titles this with a count; the two totals underneath are
 * added here because a phone shows one card at a time and "3 invoices need
 * attention" with no amounts is a notification, not information.
 */
@Composable
fun InvoiceAlertCard(
    alert: InvoiceAlert,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val count = alert.overdueCount + alert.dueCount
    val details = buildList {
        if (alert.overdueCount > 0) {
            add("${formatter.format(alert.overdueTotal)} overdue")
        }
        if (alert.dueCount > 0) {
            add("${formatter.format(alert.dueSoonTotal)} due soon")
        }
    }.joinToString(" \u00B7 ")
    BallastAlert(
        title = DashboardCopy.invoiceAlertTitle(count),
        modifier = modifier.fillMaxWidth(),
        description = details.takeIf { it.isNotEmpty() },
        variant = AlertVariant.WARNING,
    )
}

/**
 * A taste of the forecast screen: how long the money lasts and where it lands
 * in thirty days.
 */
@Composable
fun ForecastTeaserCard(
    forecast: ForecastTeaser,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    BallastCard(modifier = modifier.fillMaxWidth()) {
        Text(text = DashboardCopy.FORECAST_TITLE, style = BallastTextStyles.cardTitle)
        Text(
            text = DashboardCopy.FORECAST_SUBTITLE,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xl)) {
            InlineMetric(
                label = DashboardCopy.CASH_RUNWAY,
                value = DashboardCopy.runwayLabel(forecast.runwayMonths),
            )
            InlineMetricMoney(
                label = DashboardCopy.PROJECTED_BALANCE_30D,
                amount = forecast.projectedBalance30d,
                formatter = formatter,
            )
        }
    }
}

/** [InlineMetric] with the value rendered through the money component. */
@Composable
fun InlineMetricMoney(
    label: String,
    amount: BigDecimal,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        MoneyText(
            amount = amount,
            formatter = formatter,
            size = MoneySize.SM,
            direction = MoneyDirection.NONE,
        )
    }
}
