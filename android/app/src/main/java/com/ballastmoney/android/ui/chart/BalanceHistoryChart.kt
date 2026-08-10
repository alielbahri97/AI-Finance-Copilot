package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.BalancePoint
import com.ballastmoney.android.core.model.CashAccount
import com.ballastmoney.android.core.model.CashSource
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.dashboard.DashboardPreviewData
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.lineModel
import com.patrykandpatrick.vico.compose.cartesian.layer.LineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.Fill
import com.patrykandpatrick.vico.compose.common.data.ExtraStore
import java.math.BigDecimal

/**
 * The running balance, as one line with a fading area under it.
 *
 * The line is drawn from transaction history but *ends* at the combined bank
 * balance when there is one, which is why the description changes with the
 * source: a user who has connected a bank should be told that the right-hand
 * end of this line is the number their bank agrees with, and a user who has not
 * should be told that it is derived from what they imported.
 */
@Composable
fun BalanceHistoryChart(
    history: List<BalancePoint>,
    accounts: List<CashAccount>,
    source: CashSource,
    formatter: MoneyFormatter,
    edition: WorkspaceType,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val lineColor = colors.chartNet
    val areaColor = colors.chart1

    val title = when (edition) {
        WorkspaceType.BUSINESS -> "Cash balance history"
        WorkspaceType.PERSONAL -> "Balance over time"
    }
    val description = if (source == CashSource.BANK) {
        "Running balance, ending at your combined bank balance"
    } else {
        "Running balance across your transactions"
    }

    ChartCard(title = title, description = description, modifier = modifier) {
        if (history.isEmpty()) {
            EmptyState(
                icon = Icons.AutoMirrored.Outlined.ShowChart,
                title = "No transactions recorded yet",
                description = "The balance line is drawn from your transaction history " +
                    "\u2014 import a statement or connect a bank to fill it in.",
            )
        } else {
            BalanceLine(
                history = history,
                formatter = formatter,
                lineColor = lineColor,
                areaColor = areaColor,
            )
        }

        if (accounts.isNotEmpty()) {
            val palette = listOf(
                colors.chart1,
                colors.chart2,
                colors.chart3,
                colors.chart4,
                colors.chart5,
            )
            Spacer(modifier = Modifier.height(BallastSpacing.md))
            ChartLegend(
                entries = accounts.mapIndexed { index, account ->
                    LegendEntry(
                        label = account.name,
                        color = palette[index % palette.size],
                        value = account.balance?.let { formatter.format(it) },
                        // An account that exists but is not in the total is
                        // greyed, not dropped: otherwise the headline figure
                        // cannot be reconciled with the list under it.
                        dimmed = !account.includeInTotals,
                    )
                },
            )
        }
    }
}

@Composable
private fun BalanceLine(
    history: List<BalancePoint>,
    formatter: MoneyFormatter,
    lineColor: Color,
    areaColor: Color,
    modifier: Modifier = Modifier,
) {
    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(history) {
        modelProducer.runTransaction {
            lineModel { series(history.map { it.balance.toDouble() }) }
            // Dates are pre-formatted here rather than in the axis formatter so
            // the formatter stays a pure lookup. Balance points are one per day
            // with no gaps, so index-based x-values lose nothing — see the
            // category, not the date, branch of Vico's formatter guide.
            extras { store ->
                store[BalanceLabelsKey] = history.map { point -> formatter.formatMonthDay(point.date) }
            }
        }
    }

    val startAxisFormatter = remember(formatter) {
        CartesianValueFormatter { _, y, _ -> formatter.formatCompact(BigDecimal.valueOf(y)) }
    }
    val bottomAxisFormatter = remember {
        CartesianValueFormatter { context, x, _ ->
            context.model.extraStore[BalanceLabelsKey].getOrElse(x.toInt()) { "" }
        }
    }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberLineCartesianLayer(
                LineCartesianLayer.LineProvider.series(
                    LineCartesianLayer.Line(
                        fill = LineCartesianLayer.LineFill.single(Fill(lineColor)),
                        areaFill = LineCartesianLayer.AreaFill.single(
                            Fill(
                                Brush.verticalGradient(
                                    listOf(
                                        areaColor.copy(alpha = AREA_TOP_ALPHA),
                                        areaColor.copy(alpha = 0f),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
            startAxis = VerticalAxis.rememberStart(valueFormatter = startAxisFormatter),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = bottomAxisFormatter),
        ),
        modelProducer = modelProducer,
        modifier = modifier
            .fillMaxWidth()
            .height(CHART_HEIGHT),
    )
}

/** See the note on `MonthLabelsKey`: identity-compared, so it must be a singleton. */
private val BalanceLabelsKey = ExtraStore.Key<List<String>>()

private val CHART_HEIGHT: Dp = 220.dp
private const val AREA_TOP_ALPHA = 0.35f

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun BalanceHistoryChartPreview() {
    val snapshot = DashboardPreviewData.businessSnapshot
    BallastTheme(darkTheme = false) {
        BalanceHistoryChart(
            history = snapshot.balanceHistory,
            accounts = snapshot.cash.accounts,
            source = snapshot.cash.source,
            formatter = DashboardPreviewData.formatter,
            edition = WorkspaceType.BUSINESS,
        )
    }
}

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun BalanceHistoryChartEmptyPreview() {
    BallastTheme(darkTheme = false) {
        BalanceHistoryChart(
            history = emptyList(),
            accounts = emptyList(),
            source = CashSource.TRANSACTIONS,
            formatter = DashboardPreviewData.formatter,
            edition = WorkspaceType.PERSONAL,
        )
    }
}
