package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.ui.dashboard.DashboardPreviewData

/**
 * The last eight transactions, as a preview of the transactions screen.
 *
 * The direction arrows are the plain vertical `ArrowUpward` / `ArrowDownward`
 * icons rotated 45°, not the diagonal `NorthEast` / `SouthWest` glyphs. Both sets
 * ship in `material-icons-extended`, but the vertical pair has existed since the
 * first Material icon release and is not auto-mirrored, so it cannot be the thing
 * that breaks the first build. Rotating clockwise turns "down" into "down-left"
 * and "up" into "up-right", which is exactly the pair of arrows the web app uses.
 */
@Composable
fun RecentTransactionsCard(
    transactions: List<Transaction>,
    formatter: MoneyFormatter,
    onViewAllTransactions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = transactions.take(MAX_ROWS)
    ChartCard(
        title = "Recent transactions",
        description = "Your latest activity",
        modifier = modifier,
    ) {
        if (rows.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.SwapHoriz,
                title = "Nothing recorded yet",
                description = "Your most recent income and expenses will appear here.",
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                rows.forEach { transaction ->
                    TransactionRow(transaction = transaction, formatter = formatter)
                }
            }
            Spacer(modifier = Modifier.height(BallastSpacing.md))
            BallastSeparator()
            Spacer(modifier = Modifier.height(BallastSpacing.xs))
            BallastButton(
                text = "View all transactions",
                onClick = onViewAllTransactions,
                variant = ButtonVariant.LINK,
            )
        }
    }
}

@Composable
private fun TransactionRow(
    transaction: Transaction,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val isIncome = transaction.type == TransactionType.INCOME
    val accent = if (isIncome) colors.success else colors.destructiveSolid
    val tint = if (isIncome) colors.successTinted else colors.destructiveTinted
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(BADGE_SIZE)
                .background(color = tint, shape = CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (isIncome) Icons.Filled.ArrowDownward else Icons.Filled.ArrowUpward,
                contentDescription = null,
                tint = accent,
                modifier = Modifier
                    .size(ICON_SIZE)
                    .rotate(DIAGONAL_ROTATION),
            )
        }
        Spacer(modifier = Modifier.width(BallastSpacing.sm))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = transaction.description,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                CategoryDot(colorHex = transaction.categoryColor)
                Spacer(modifier = Modifier.width(BallastSpacing.xs))
                Text(
                    text = transaction.categoryName ?: "Uncategorized",
                    style = BallastTextStyles.micro,
                    color = colors.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.width(BallastSpacing.xs))
                Text(
                    text = "\u00B7 ${formatter.formatDate(transaction.date)}",
                    style = BallastTextStyles.micro,
                    color = colors.mutedForeground,
                    maxLines = 1,
                )
            }
        }
        Spacer(modifier = Modifier.width(BallastSpacing.sm))
        MoneyText(
            amount = transaction.amount,
            formatter = formatter,
            size = MoneySize.SM,
            direction = if (isIncome) MoneyDirection.INCOME else MoneyDirection.EXPENSE,
        )
    }
}

private const val MAX_ROWS = 8

/** Clockwise: "down" becomes "down-left", "up" becomes "up-right". */
private const val DIAGONAL_ROTATION = 45f
private val BADGE_SIZE: Dp = 28.dp
private val ICON_SIZE: Dp = 14.dp

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun RecentTransactionsCardPreview() {
    BallastTheme(darkTheme = false) {
        RecentTransactionsCard(
            transactions = DashboardPreviewData.businessSnapshot.recentTransactions,
            formatter = DashboardPreviewData.formatter,
            onViewAllTransactions = {},
        )
    }
}

@Preview(showBackground = true, widthDp = 420)
@Composable
private fun RecentTransactionsCardEmptyPreview() {
    BallastTheme(darkTheme = false) {
        RecentTransactionsCard(
            transactions = emptyList(),
            formatter = DashboardPreviewData.formatter,
            onViewAllTransactions = {},
        )
    }
}
