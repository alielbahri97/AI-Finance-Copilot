package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.dashboard.DashboardPreviewData
import java.math.BigDecimal

/**
 * The five biggest outgoings, each with a bar showing its size relative to the
 * largest one.
 *
 * The bars are scaled against the top row rather than against total spending.
 * Against the total they would all be short stubs and tell you nothing; against
 * each other they answer the actual question, which is "how much bigger is the
 * worst one".
 */
@Composable
fun LargestExpensesCard(
    expenses: List<Transaction>,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val rows = expenses.take(MAX_ROWS)
    val largest = rows.maxOfOrNull { it.amount } ?: BigDecimal.ZERO
    ChartCard(
        title = "Largest expenses",
        description = "Your biggest outgoings (last 6 months)",
        modifier = modifier,
    ) {
        if (rows.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.SwapHoriz,
                title = "No expenses yet",
                description = "Once spending lands here, the biggest items show up first.",
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.md)) {
                rows.forEach { expense ->
                    LargestExpenseRow(
                        expense = expense,
                        largest = largest,
                        formatter = formatter,
                    )
                }
            }
        }
    }
}

@Composable
private fun LargestExpenseRow(
    expense: Transaction,
    largest: BigDecimal,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val fraction = proportionOf(expense.amount, largest)
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = expense.description,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = listOfNotNull(
                        expense.categoryName,
                        formatter.formatDate(expense.date),
                    ).joinToString(" \u00B7 "),
                    style = BallastTextStyles.micro,
                    color = colors.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(modifier = Modifier.width(BallastSpacing.sm))
            MoneyText(
                amount = expense.amount,
                formatter = formatter,
                size = MoneySize.SM,
                direction = MoneyDirection.EXPENSE,
            )
        }
        Spacer(modifier = Modifier.height(BallastSpacing.xs))
        ProportionBar(fraction = fraction)
    }
}

@Composable
private fun ProportionBar(
    fraction: Float,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val shape = RoundedCornerShape(BallastRadius.sm)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(BAR_HEIGHT)
            .background(color = colors.cardBorder, shape = shape),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                // A zero-width bar looks like a rendering fault, so the
                // smallest row still shows a sliver.
                .fillMaxWidth(fraction.coerceIn(MIN_BAR_FRACTION, 1f))
                .background(color = colors.chartExpense, shape = shape),
        )
    }
}

internal fun proportionOf(amount: BigDecimal, largest: BigDecimal): Float {
    if (largest.signum() <= 0) return 0f
    val ratio = amount.toDouble() / largest.toDouble()
    return ratio.toFloat()
}

private const val MAX_ROWS = 5
private const val MIN_BAR_FRACTION = 0.04f
private val BAR_HEIGHT: Dp = 6.dp

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun LargestExpensesCardPreview() {
    BallastTheme(darkTheme = false) {
        LargestExpensesCard(
            expenses = DashboardPreviewData.businessSnapshot.largestExpenses,
            formatter = DashboardPreviewData.formatter,
        )
    }
}

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun LargestExpensesCardEmptyPreview() {
    BallastTheme(darkTheme = false) {
        LargestExpensesCard(
            expenses = emptyList(),
            formatter = DashboardPreviewData.formatter,
        )
    }
}
