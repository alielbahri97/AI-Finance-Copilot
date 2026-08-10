package com.ballastmoney.android.ui.transactions

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.ballastmoney.android.core.model.SortDirection
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.core.model.TransactionSortKey
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastListRow

@Composable
internal fun TransactionSortSheet(
    query: TransactionQuery,
    onDismiss: () -> Unit,
    onSelect: (TransactionSortKey) -> Unit,
) {
    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = "Sort",
        description = "Tap the current column again to flip the direction.",
    ) {
        TransactionSortSheetContent(query = query, onSelect = onSelect)
    }
}

/**
 * The table header the phone does not have. Picking the active key toggles its
 * direction; picking a new one starts from that column's own default, so amounts
 * and dates open at the largest and text opens at A — the same rule the web
 * header applies.
 */
@Composable
internal fun TransactionSortSheetContent(
    query: TransactionQuery,
    onSelect: (TransactionSortKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    SheetOptionList(modifier = modifier) {
        TransactionSortKey.entries.forEach { key ->
            val active = query.sort == key
            val direction = if (active) query.direction else key.defaultDirection
            BallastListRow(
                title = sortKeyLabel(key),
                subtitle = sortDirectionLabel(key, direction),
                onClick = { onSelect(key) },
                selected = active,
                trailing = {
                    Icon(
                        imageVector = if (direction == SortDirection.DESC) {
                            Icons.Filled.ArrowDownward
                        } else {
                            Icons.Filled.ArrowUpward
                        },
                        contentDescription = null,
                    )
                },
            )
        }
    }
}
