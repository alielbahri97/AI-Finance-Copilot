package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import java.math.BigDecimal
import java.time.LocalDate

/**
 * Previews render the stateless halves of the screen. The sheets are previewed
 * as their content composables rather than through `ModalBottomSheet`, which
 * needs a real window to lay out.
 */

@Preview(name = "Transactions — populated", showBackground = true, widthDp = 400, heightDp = 900)
@Composable
private fun TransactionsPopulatedPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState(),
            paged = rememberPreviewPagingItems(previewTransactions),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Transactions — uncategorized heavy", showBackground = true, widthDp = 400, heightDp = 900)
@Composable
private fun TransactionsUncategorizedPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState(),
            paged = rememberPreviewPagingItems(previewUncategorizedTransactions),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Transactions — selection mode", showBackground = true, widthDp = 400, heightDp = 900)
@Composable
private fun TransactionsSelectionPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState(selection = setOf("txn-2", "txn-3", "txn-4")),
            paged = rememberPreviewPagingItems(previewTransactions),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Transactions — filtered, no matches", showBackground = true, widthDp = 400, heightDp = 700)
@Composable
private fun TransactionsEmptyFilteredPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState(
                query = TransactionQuery(
                    search = "hotel",
                    type = TransactionType.EXPENSE,
                    from = LocalDate.parse("2026-08-01"),
                    to = LocalDate.parse("2026-08-31"),
                    minAmount = BigDecimal("500"),
                ),
                aggregates = previewAggregates.copy(totalCount = 0),
            ),
            paged = rememberPreviewPagingItems(emptyList()),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Transactions — nothing yet", showBackground = true, widthDp = 400, heightDp = 700)
@Composable
private fun TransactionsEmptyPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState(aggregates = previewAggregates.copy(totalCount = 0)),
            paged = rememberPreviewPagingItems(emptyList()),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Transactions — no access", showBackground = true, widthDp = 400, heightDp = 500)
@Composable
private fun TransactionsNoAccessPreview() {
    BallastTheme {
        TransactionsContent(
            state = previewState().copy(permissions = emptySet()),
            paged = rememberPreviewPagingItems(emptyList()),
            actions = TransactionsActions(),
        )
    }
}

@Preview(name = "Sheet — filters", showBackground = true, widthDp = 400, heightDp = 900)
@Composable
private fun FilterSheetPreview() {
    BallastTheme {
        PreviewSheetSurface {
            TransactionFilterSheetContent(
                query = TransactionQuery(type = TransactionType.EXPENSE, from = LocalDate.parse("2026-08-01")),
                categories = previewCategories,
                importBatches = previewImportBatches,
                formatter = previewFormatter,
                onApply = {},
            )
        }
    }
}

@Preview(name = "Sheet — add transaction", showBackground = true, widthDp = 400, heightDp = 900)
@Composable
private fun AddTransactionSheetPreview() {
    BallastTheme {
        PreviewSheetSurface {
            TransactionEditorSheetContent(
                existing = null,
                categories = previewCategories,
                formatter = previewFormatter,
                isSaving = false,
                onSave = { _, _ -> },
            )
        }
    }
}

@Preview(name = "Sheet — category picker", showBackground = true, widthDp = 400, heightDp = 700)
@Composable
private fun CategoryPickerSheetPreview() {
    BallastTheme {
        PreviewSheetSurface {
            TransactionCategorySheetContent(
                transaction = previewTransactions[2],
                selectionCount = 0,
                categories = previewCategories,
                formatter = previewFormatter,
                onPick = {},
            )
        }
    }
}

@Preview(name = "Sheet — sort", showBackground = true, widthDp = 400, heightDp = 420)
@Composable
private fun SortSheetPreview() {
    BallastTheme {
        PreviewSheetSurface {
            TransactionSortSheetContent(query = TransactionQuery(), onSelect = {})
        }
    }
}

@Composable
private fun PreviewSheetSurface(content: @Composable () -> Unit) {
    Surface {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(BallastSpacing.lg),
        ) {
            content()
        }
    }
}
