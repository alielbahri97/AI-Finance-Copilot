package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.CategorySlice
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.dashboard.DashboardCopy
import com.ballastmoney.android.ui.dashboard.DashboardPreviewData
import java.math.BigDecimal
import kotlin.math.min

/**
 * Spending by category, as a ring drawn by hand.
 *
 * This one deliberately does not use a chart library. Every Android charting
 * library treats a pie as an afterthought: they draw filled wedges with no ring
 * width control, they insist on their own legend and label placement, and they
 * fight the theme. A donut is eight `drawArc` calls — writing them is less code
 * than configuring a library out of the way, and it is the only way to get the
 * exact ring thickness, slice gap and centred total the web app has.
 *
 * The ring is normalised over the categories it shows rather than over all
 * spending. The payload is the top eight categories, so normalising over the
 * true total would leave a mystery gap in the ring; normalising over what is
 * drawn keeps the geometry honest about what the legend lists.
 */
@Composable
fun SpendingByCategoryChart(
    slices: List<CategorySlice>,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val total = slices.fold(BigDecimal.ZERO) { sum, slice -> sum.add(slice.amount) }
    ChartCard(
        title = "Spending by category",
        description = "Where your money went (last 6 months)",
        modifier = modifier,
    ) {
        if (slices.isEmpty() || total.signum() <= 0) {
            EmptyState(
                icon = Icons.Outlined.LocalOffer,
                title = "No expenses recorded yet",
                description = "Once money starts going out, this shows which categories it goes to.",
            )
        } else {
            val summary = buildAccessibilitySummary(slices, total, formatter)
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                if (maxWidth < SIDE_BY_SIDE_MIN_WIDTH) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        SpendingDonut(
                            slices = slices,
                            centerValue = formatter.format(total),
                            summary = summary,
                        )
                        Spacer(modifier = Modifier.height(BallastSpacing.lg))
                        CategoryLegend(
                            slices = slices,
                            formatter = formatter,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SpendingDonut(
                            slices = slices,
                            centerValue = formatter.format(total),
                            summary = summary,
                        )
                        Spacer(modifier = Modifier.width(BallastSpacing.xl))
                        CategoryLegend(
                            slices = slices,
                            formatter = formatter,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The ring itself.
 *
 * Arcs start at -90° (twelve o'clock) and run clockwise, which is the direction
 * every finance dashboard uses and the one the web app draws. The stroke is
 * inset by half its width so the ring sits fully inside the canvas instead of
 * being clipped at the four cardinal points.
 */
@Composable
private fun SpendingDonut(
    slices: List<CategorySlice>,
    centerValue: String,
    summary: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(DONUT_SIZE)
            .semantics { contentDescription = summary },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val strokeWidth = DONUT_STROKE.toPx()
            val diameter = min(size.width, size.height) - strokeWidth
            if (diameter <= 0f) return@Canvas
            val topLeft = Offset(
                x = (size.width - diameter) / 2f,
                y = (size.height - diameter) / 2f,
            )
            val arcSize = Size(diameter, diameter)
            val total = slices.sumOf { it.amount.toDouble() }
            if (total <= 0.0) return@Canvas

            var startAngle = START_ANGLE
            slices.forEach { slice ->
                val share = (slice.amount.toDouble() / total).toFloat()
                val fullSweep = share * FULL_CIRCLE
                // The gap is taken out of the slice rather than added between
                // slices, so the ring still closes at twelve o'clock.
                val visibleSweep = (fullSweep - SLICE_GAP_DEGREES)
                    .coerceAtLeast(MIN_SLICE_DEGREES)
                drawArc(
                    color = parseHexColor(slice.color),
                    startAngle = startAngle,
                    sweepAngle = visibleSweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Butt),
                )
                startAngle += fullSweep
            }
        }
        Text(
            text = centerValue,
            style = BallastTextStyles.moneyMd,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = DONUT_STROKE),
        )
    }
}

@Composable
private fun CategoryLegend(
    slices: List<CategorySlice>,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        slices.forEach { slice ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CategoryDot(colorHex = slice.color)
                Spacer(modifier = Modifier.width(BallastSpacing.sm))
                Text(
                    text = slice.name,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(BallastSpacing.sm))
                Text(
                    text = formatter.format(slice.amount),
                    style = BallastTextStyles.moneySm,
                )
                Spacer(modifier = Modifier.width(BallastSpacing.sm))
                Text(
                    text = DashboardCopy.shareLabel(slice.sharePct),
                    style = BallastTextStyles.micro,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
        }
    }
}

/**
 * A ring is invisible to a screen reader, so the whole breakdown is spoken as
 * one description on the donut. The legend rows underneath are read separately,
 * which is repetitive but not wrong — someone who lands on the graphic first
 * still gets the answer without having to walk the list.
 */
private fun buildAccessibilitySummary(
    slices: List<CategorySlice>,
    total: BigDecimal,
    formatter: MoneyFormatter,
): String {
    val breakdown = slices.joinToString(separator = ", ") { slice ->
        "${slice.name} ${formatter.format(slice.amount)}, ${DashboardCopy.shareLabel(slice.sharePct)}"
    }
    return "Spending by category. Total ${formatter.format(total)}. $breakdown"
}

private val DONUT_SIZE: Dp = 180.dp
private val DONUT_STROKE: Dp = 22.dp
private val SIDE_BY_SIDE_MIN_WIDTH: Dp = 560.dp
private const val START_ANGLE = -90f
private const val FULL_CIRCLE = 360f
private const val SLICE_GAP_DEGREES = 2f
private const val MIN_SLICE_DEGREES = 1f

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun SpendingByCategoryChartPreview() {
    BallastTheme(darkTheme = false) {
        SpendingByCategoryChart(
            slices = DashboardPreviewData.businessSnapshot.spendingByCategory,
            formatter = DashboardPreviewData.formatter,
        )
    }
}

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun SpendingByCategoryChartEmptyPreview() {
    BallastTheme(darkTheme = false) {
        SpendingByCategoryChart(
            slices = emptyList(),
            formatter = DashboardPreviewData.formatter,
        )
    }
}
