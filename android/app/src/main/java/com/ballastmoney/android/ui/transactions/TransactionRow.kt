package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.component.BadgeVariant
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.component.BallastCheckbox
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.MoneyTone
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * One transaction, as a card rather than a table row.
 *
 * The web app renders a dense sortable table, which does not survive a 360dp
 * screen: eight columns become eight ellipses. The information that matters at a
 * glance — what it was, when, which category, how much — reads better stacked,
 * and the sort controls move into a sheet.
 *
 * Uncategorized rows are tinted and badged, the same nudge the web table applies
 * with a highlighted row, because labelling those is the single most useful
 * thing a user can do here.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun TransactionRow(
    transaction: Transaction,
    formatter: MoneyFormatter,
    selected: Boolean,
    selectionMode: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val shape = RoundedCornerShape(BallastRadius.md)
    val isIncome = transaction.type == TransactionType.INCOME

    val background = when {
        selected -> MaterialTheme.colorScheme.secondaryContainer
        transaction.isUncategorized -> colors.warningTinted
        else -> MaterialTheme.colorScheme.surface
    }
    val borderColor = if (selected) MaterialTheme.colorScheme.primary else colors.cardBorder

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        shape = shape,
        color = background,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier.padding(BallastSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            if (selectionMode) {
                BallastCheckbox(checked = selected, onCheckedChange = { onClick() })
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(BallastSpacing.xxs),
            ) {
                Text(
                    text = transaction.description,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                Text(
                    text = secondaryLine(transaction, formatter),
                    style = BallastTextStyles.micro,
                    color = colors.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
                ) {
                    CategoryDot(colorHex = transaction.categoryColor)
                    Text(
                        text = transaction.categoryName ?: "Uncategorized",
                        style = BallastTextStyles.micro,
                        color = if (transaction.isUncategorized) colors.warningForeground else colors.mutedForeground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (transaction.isUncategorized) {
                        BallastBadge(text = "Teach AI", variant = BadgeVariant.WARNING)
                    }
                }
            }

            MoneyText(
                amount = transaction.amount,
                formatter = formatter,
                direction = if (isIncome) MoneyDirection.INCOME else MoneyDirection.EXPENSE,
                size = MoneySize.MD,
                tone = if (isIncome) MoneyTone.SUCCESS else MoneyTone.DEFAULT,
            )
        }
    }
}

/**
 * Date, plus whoever the money moved to or from when we know it. Joined into one
 * line so a missing counterparty does not leave a stray separator behind.
 */
private fun secondaryLine(transaction: Transaction, formatter: MoneyFormatter): String {
    val date = formatter.formatDate(transaction.date)
    val who = transaction.counterparty?.takeIf { it.isNotBlank() }
        ?: transaction.invoiceVendor?.takeIf { it.isNotBlank() }
    return if (who == null) date else "$date \u00B7 $who"
}

/** Placeholder for a row whose page has not arrived yet. */
@Composable
internal fun TransactionRowPlaceholder(modifier: Modifier = Modifier) {
    val colors = MaterialTheme.ballastColors
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(BallastRadius.md),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, colors.cardBorder),
    ) {
        Text(
            text = "\u2026",
            style = BallastTextStyles.micro,
            color = colors.mutedForeground,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = BallastSpacing.lg),
        )
    }
}
