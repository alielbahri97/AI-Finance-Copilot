package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The shared skeleton of every sheet body on this screen.
 *
 * Option lists inside are plain [Column]s rather than `LazyColumn`s on purpose:
 * one scroll container per sheet means no nested-scroll fight with the modal
 * sheet itself, and a workspace's category list is dozens of rows at most. The
 * explicit [heightIn] cap also guarantees the content never asks for an infinite
 * height, which is what makes a scrollable safe inside a scrollable parent.
 */
@Composable
internal fun SheetBody(
    modifier: Modifier = Modifier,
    maxHeight: Int = DEFAULT_SHEET_MAX_HEIGHT_DP,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = maxHeight.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        content()
    }
}

@Composable
internal fun SheetSectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = BallastTextStyles.sectionLabel,
        color = MaterialTheme.ballastColors.mutedForeground,
        modifier = modifier,
    )
}

@Composable
internal fun SheetHint(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = BallastTextStyles.micro,
        color = MaterialTheme.ballastColors.mutedForeground,
        modifier = modifier,
    )
}

/** A tight column of option rows, used for categories, sources and sort keys. */
@Composable
internal fun SheetOptionList(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.xxs),
    ) {
        content()
    }
}

@Composable
internal fun SheetActionRow(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        content()
    }
}

private const val DEFAULT_SHEET_MAX_HEIGHT_DP = 560
