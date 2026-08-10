package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.component.BadgeVariant
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastListRow
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.MoneyTone
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Labelling one row, or every selected row.
 *
 * This is the screen's most important interaction: it is how the categoriser
 * learns, so the copy leans into that when the row has no category yet.
 */
@Composable
internal fun TransactionCategorySheet(
    transaction: Transaction?,
    selectionCount: Int,
    categories: List<Category>,
    formatter: MoneyFormatter,
    onDismiss: () -> Unit,
    onPick: (String?) -> Unit,
) {
    val teaching = transaction?.isUncategorized == true
    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = if (teaching) "Help Ballast learn this one" else "Change category",
        description = when {
            transaction != null -> "Pick the category this belongs to. Ballast remembers similar rows next time."
            selectionCount > 0 -> "This applies to every selected transaction."
            else -> null
        },
    ) {
        TransactionCategorySheetContent(
            transaction = transaction,
            selectionCount = selectionCount,
            categories = categories,
            formatter = formatter,
            onPick = onPick,
        )
    }
}

@Composable
internal fun TransactionCategorySheetContent(
    transaction: Transaction?,
    selectionCount: Int,
    categories: List<Category>,
    formatter: MoneyFormatter,
    onPick: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    // With one row we know its type, so only categories of that type can apply.
    // A bulk change can span both types, so it offers everything.
    val options = if (transaction != null) categories.filter { it.type == transaction.type } else categories

    SheetBody(modifier = modifier) {
        if (transaction != null) {
            TransactionSummaryCard(transaction = transaction, formatter = formatter)
        } else if (selectionCount > 0) {
            SheetSectionLabel(text = "$selectionCount selected")
        }

        SheetOptionList {
            BallastListRow(
                title = "Uncategorized",
                subtitle = "Leave this one for later",
                selected = transaction?.categoryId == null,
                onClick = { onPick(null) },
            )
            options.forEach { category ->
                BallastListRow(
                    title = category.name,
                    onClick = { onPick(category.id) },
                    selected = transaction?.categoryId == category.id,
                    leading = { CategoryDot(colorHex = category.color) },
                )
            }
        }

        if (options.isEmpty()) {
            SheetHint(
                text = "This workspace has no categories for that type yet. Create one on the web app first.",
            )
        }
    }
}

/** What the user is labelling: how much, when, and which direction. */
@Composable
private fun TransactionSummaryCard(
    transaction: Transaction,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val isIncome = transaction.type == TransactionType.INCOME
    BallastCard(modifier = modifier.fillMaxWidth()) {
        Text(
            text = transaction.description,
            style = BallastTextStyles.cardTitle,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                MoneyText(
                    amount = transaction.amount,
                    formatter = formatter,
                    direction = if (isIncome) MoneyDirection.INCOME else MoneyDirection.EXPENSE,
                    size = MoneySize.MD,
                    tone = if (isIncome) MoneyTone.SUCCESS else MoneyTone.DEFAULT,
                )
                Text(
                    text = formatter.formatDate(transaction.date),
                    style = BallastTextStyles.micro,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
            BallastBadge(
                text = typeLabel(transaction.type),
                variant = if (isIncome) BadgeVariant.SUCCESS else BadgeVariant.SECONDARY,
            )
        }
    }
}
