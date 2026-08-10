package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastFilterChip
import com.ballastmoney.android.designsystem.component.BallastSearchField
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing

/**
 * Search, the two controls that open the filter and sort sheets, and the chips
 * that show what is currently narrowing the list.
 *
 * Search is debounced in the ViewModel, not here, so the field stays a plain
 * function of state and every keystroke is rendered immediately.
 */
@Composable
internal fun TransactionsToolbar(
    state: TransactionsUiState,
    actions: TransactionsActions,
    modifier: Modifier = Modifier,
) {
    val chips = activeFilterChips(
        query = state.query,
        categories = state.categories,
        importBatches = state.importBatches,
        formatter = state.formatter,
    )

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        BallastSearchField(
            value = state.query.search,
            onValueChange = actions.onSearchChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = "Search description or counterparty\u2026",
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BallastButton(
                text = if (state.activeFilterCount > 0) "Filters (${state.activeFilterCount})" else "Filters",
                onClick = actions.onOpenFilters,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
                leadingIcon = Icons.Filled.FilterList,
            )
            BallastButton(
                text = sortSummary(state.query),
                onClick = actions.onOpenSort,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
                leadingIcon = Icons.Filled.SwapVert,
            )
        }

        if (chips.isNotEmpty() || state.query.search.isNotBlank()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                chips.forEach { chip ->
                    BallastFilterChip(
                        text = chip.text,
                        onClear = { actions.onApplyQuery(chip.cleared) },
                    )
                }
                BallastButton(
                    text = "Clear",
                    onClick = actions.onClearFilters,
                    variant = ButtonVariant.GHOST,
                    size = ButtonSize.SMALL,
                )
            }
        }

        if (state.query.hasInvalidRange) {
            BallastAlert(
                title = "The end date comes before the start date, so nothing would match.",
                modifier = Modifier.fillMaxWidth(),
                variant = AlertVariant.DESTRUCTIVE,
                icon = Icons.Filled.ErrorOutline,
            )
        }
    }
}
