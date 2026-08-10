package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.MonthlyPoint
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.dashboard.DashboardPreviewData
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.columnModel
import com.patrykandpatrick.vico.compose.cartesian.data.lineModel
import com.patrykandpatrick.vico.compose.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.LineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.Fill
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.compose.common.data.ExtraStore
import java.math.BigDecimal

/**
 * Income and expenses as grouped columns, with net as a line over the top.
 *
 * Why a combo chart rather than two: net is not a third bar, it is the
 * difference between the other two, and drawing it as a line makes crossing
 * below zero legible at a glance. That is the shape the web app uses and the
 * one people already recognise from their accountant's reports.
 *
 * The month labels ride along in the model's [ExtraStore] rather than being
 * captured by the formatter lambda. Vico's formatters are invoked against
 * whatever model is currently drawn — including the *previous* model, mid
 * difference-animation — so a captured list can be indexed with an x-value that
 * belongs to a different data set. Reading the labels back out of the model that
 * is being drawn is the documented pattern and the only one that cannot go out
 * of step.
 */
@Composable
fun MonthlyCashflowChart(
    points: List<MonthlyPoint>,
    formatter: MoneyFormatter,
    edition: WorkspaceType,
    modifier: Modifier = Modifier,
) {
    // The payload promises six zero-filled entries, so an empty list means the
    // shape changed rather than that the user has no data. Nothing sensible to
    // draw and no honest copy to show, so the card stands down.
    if (points.isEmpty()) return

    val colors = MaterialTheme.ballastColors
    val incomeColor = colors.chartIncome
    val expenseColor = colors.chartExpense
    val netColor = colors.chartNet

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(points) {
        modelProducer.runTransaction {
            columnModel {
                series(points.map { it.income.toDouble() })
                series(points.map { it.expenses.toDouble() })
            }
            lineModel { series(points.map { it.net.toDouble() }) }
            extras { store -> store[MonthLabelsKey] = points.map { point -> point.label } }
        }
    }

    val startAxisFormatter = remember(formatter) {
        CartesianValueFormatter { _, y, _ -> formatter.formatCompact(BigDecimal.valueOf(y)) }
    }
    val bottomAxisFormatter = remember {
        CartesianValueFormatter { context, x, _ ->
            context.model.extraStore[MonthLabelsKey].getOrElse(x.toInt()) { "" }
        }
    }

    ChartCard(
        title = when (edition) {
            WorkspaceType.BUSINESS -> "Monthly cashflow"
            WorkspaceType.PERSONAL -> "Money in and out"
        },
        description = when (edition) {
            WorkspaceType.BUSINESS -> "Income, expenses and net per month"
            WorkspaceType.PERSONAL -> "What came in, what went out, and what you kept each month"
        },
        modifier = modifier,
    ) {
        CartesianChartHost(
            chart = rememberCartesianChart(
                rememberColumnCartesianLayer(
                    ColumnCartesianLayer.ColumnProvider.series(
                        rememberLineComponent(Fill(incomeColor), COLUMN_THICKNESS),
                        rememberLineComponent(Fill(expenseColor), COLUMN_THICKNESS),
                    ),
                ),
                rememberLineCartesianLayer(
                    LineCartesianLayer.LineProvider.series(
                        LineCartesianLayer.Line(
                            fill = LineCartesianLayer.LineFill.single(Fill(netColor)),
                        ),
                    ),
                ),
                startAxis = VerticalAxis.rememberStart(valueFormatter = startAxisFormatter),
                bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = bottomAxisFormatter),
            ),
            modelProducer = modelProducer,
            modifier = Modifier
                .fillMaxWidth()
                .height(CHART_HEIGHT),
        )
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        ChartLegend(
            entries = listOf(
                LegendEntry(
                    label = "Income",
                    color = incomeColor,
                    value = formatter.format(points.sumOfAmounts { it.income }),
                ),
                LegendEntry(
                    label = "Expenses",
                    color = expenseColor,
                    value = formatter.format(points.sumOfAmounts { it.expenses }),
                ),
                LegendEntry(
                    label = "Net cashflow",
                    color = netColor,
                    value = formatter.format(points.sumOfAmounts { it.net }),
                ),
            ),
        )
    }
}

private inline fun List<MonthlyPoint>.sumOfAmounts(select: (MonthlyPoint) -> BigDecimal): BigDecimal =
    fold(BigDecimal.ZERO) { total, point -> total.add(select(point)) }

/**
 * The key the month labels travel under. A single top-level instance, because
 * an `ExtraStore.Key` is compared by identity: a key created inside a
 * composition would be a different key on every recomposition and every lookup
 * would miss.
 */
private val MonthLabelsKey = ExtraStore.Key<List<String>>()

private val COLUMN_THICKNESS: Dp = 10.dp
private val CHART_HEIGHT: Dp = 220.dp

// `darkTheme` is passed explicitly in every preview in this package rather than
// left to the theme's `isSystemInDarkTheme()` default, so a preview renders the
// same regardless of the IDE's current appearance setting.
@Preview(showBackground = true, widthDp = 420)
@Composable
private fun MonthlyCashflowChartBusinessPreview() {
    BallastTheme(darkTheme = false) {
        MonthlyCashflowChart(
            points = DashboardPreviewData.businessSnapshot.monthly,
            formatter = DashboardPreviewData.formatter,
            edition = WorkspaceType.BUSINESS,
        )
    }
}

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun MonthlyCashflowChartPersonalPreview() {
    BallastTheme(darkTheme = false) {
        MonthlyCashflowChart(
            points = DashboardPreviewData.personalSnapshot.monthly,
            formatter = DashboardPreviewData.formatter,
            edition = WorkspaceType.PERSONAL,
        )
    }
}
