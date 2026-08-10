package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastFilterChip
import com.ballastmoney.android.designsystem.component.BallastListRow
import com.ballastmoney.android.designsystem.component.BallastTabs
import com.ballastmoney.android.designsystem.component.BallastTextField
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.theme.BallastSpacing

@Composable
internal fun TransactionFilterSheet(
    state: TransactionsUiState,
    onDismiss: () -> Unit,
    onApply: (TransactionQuery) -> Unit,
) {
    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = "Filters",
        description = "Narrow the list down, then apply.",
    ) {
        TransactionFilterSheetContent(
            query = state.query,
            categories = state.categories,
            importBatches = state.importBatches,
            formatter = state.formatter,
            onApply = onApply,
        )
    }
}

/**
 * Everything `GET /api/transactions` filters on, except the search box, which
 * lives in the toolbar.
 *
 * The sheet edits a local draft and commits on Apply, rather than reloading on
 * every tap: seven filters would otherwise mean seven round trips and seven
 * paging resets before the user finished choosing.
 */
@Composable
internal fun TransactionFilterSheetContent(
    query: TransactionQuery,
    categories: List<Category>,
    importBatches: List<ImportBatch>,
    formatter: MoneyFormatter,
    onApply: (TransactionQuery) -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember(query) { mutableStateOf(query) }
    var fromText by remember(query) { mutableStateOf(query.from?.toString().orEmpty()) }
    var toText by remember(query) { mutableStateOf(query.to?.toString().orEmpty()) }
    var minText by remember(query) { mutableStateOf(query.minAmount?.toPlainString().orEmpty()) }
    var maxText by remember(query) { mutableStateOf(query.maxAmount?.toPlainString().orEmpty()) }

    // Unparseable or negative bounds are dropped rather than rejected, which
    // matches the web app: a half-typed date should not block Apply.
    fun composedQuery(): TransactionQuery = draft.copy(
        from = parseDateInput(fromText),
        to = parseDateInput(toText),
        minAmount = parseFilterAmount(minText),
        maxAmount = parseFilterAmount(maxText),
    )

    SheetBody(modifier = modifier) {
        SheetSectionLabel(text = "Type")
        BallastTabs(
            tabs = listOf("All types", "Income", "Expenses"),
            selectedIndex = when (draft.type) {
                null -> 0
                TransactionType.INCOME -> 1
                TransactionType.EXPENSE -> 2
            },
            onSelect = { index ->
                draft = draft.copy(
                    type = when (index) {
                        1 -> TransactionType.INCOME
                        2 -> TransactionType.EXPENSE
                        else -> null
                    },
                )
            },
            modifier = Modifier.fillMaxWidth(),
        )

        SheetSectionLabel(text = "Category")
        SheetOptionList {
            BallastListRow(
                title = "All categories",
                selected = draft.categoryId == null,
                onClick = { draft = draft.copy(categoryId = null) },
            )
            BallastListRow(
                title = "Uncategorized",
                subtitle = "Rows Ballast has not learned yet",
                selected = draft.categoryId == TransactionQuery.UNCATEGORIZED,
                onClick = { draft = draft.copy(categoryId = TransactionQuery.UNCATEGORIZED) },
            )
            categories.forEach { category ->
                BallastListRow(
                    title = category.name,
                    subtitle = typeLabel(category.type),
                    onClick = { draft = draft.copy(categoryId = category.id) },
                    selected = draft.categoryId == category.id,
                    leading = { CategoryDot(colorHex = category.color) },
                )
            }
        }

        SheetSectionLabel(text = "Source")
        SheetOptionList {
            BallastListRow(
                title = "All sources",
                selected = draft.importBatchId == null,
                onClick = { draft = draft.copy(importBatchId = null) },
            )
            importBatches.forEach { batch ->
                BallastListRow(
                    title = importBatchLabel(batch = batch, formatter = formatter),
                    selected = draft.importBatchId == batch.id,
                    onClick = { draft = draft.copy(importBatchId = batch.id) },
                )
            }
        }

        SheetSectionLabel(text = "Date range")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            BallastTextField(
                value = fromText,
                onValueChange = { fromText = it },
                modifier = Modifier.weight(1f),
                label = "From",
                placeholder = "YYYY-MM-DD",
                supportingText = dateSupportingText(fromText, formatter),
                singleLine = true,
            )
            BallastTextField(
                value = toText,
                onValueChange = { toText = it },
                modifier = Modifier.weight(1f),
                label = "To",
                placeholder = "YYYY-MM-DD",
                supportingText = dateSupportingText(toText, formatter),
                singleLine = true,
            )
        }

        SheetSectionLabel(text = "Amount")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            BallastTextField(
                value = minText,
                onValueChange = { minText = it },
                modifier = Modifier.weight(1f),
                label = "Min",
                placeholder = "0.00",
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            BallastTextField(
                value = maxText,
                onValueChange = { maxText = it },
                modifier = Modifier.weight(1f),
                label = "Max",
                placeholder = "0.00",
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
        }
        SheetHint(text = "Amounts are compared against the value, not the sign.")

        SheetSectionLabel(text = "Rows per page")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            TransactionQuery.PAGE_SIZE_OPTIONS.forEach { option ->
                BallastFilterChip(
                    text = option.toString(),
                    selected = draft.pageSize == option,
                    onClick = { draft = draft.copy(pageSize = option) },
                )
            }
        }

        SheetActionRow {
            BallastButton(
                text = "Reset",
                onClick = { onApply(query.cleared()) },
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.OUTLINE,
                fillMaxWidth = true,
            )
            BallastButton(
                text = "Apply",
                onClick = { onApply(composedQuery()) },
                modifier = Modifier.weight(1f),
                fillMaxWidth = true,
            )
        }
    }
}

/** Echoes the parsed date back so a typo is obvious before Apply. */
private fun dateSupportingText(raw: String, formatter: MoneyFormatter): String? {
    if (raw.isBlank()) return null
    val parsed = parseDateInput(raw) ?: return "Use YYYY-MM-DD"
    return formatter.formatDate(parsed)
}
