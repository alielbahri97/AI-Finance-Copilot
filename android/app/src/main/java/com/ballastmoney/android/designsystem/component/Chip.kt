package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * An applied filter, as used by the transactions toolbar.
 *
 * A chip with an [onClear] shows a dismiss affordance; the chip body stays
 * separately tappable so "change this filter" and "remove this filter" are
 * different targets.
 */
@Composable
fun BallastFilterChip(
    text: String,
    onClear: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    selected: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors
    val container = if (selected) scheme.primaryContainer else Color.Transparent
    val content = if (selected) extended.accentForeground else extended.mutedForeground

    Row(
        modifier = modifier
            .heightIn(min = 28.dp)
            .clip(Pill)
            .background(container, Pill)
            .then(if (selected) Modifier else Modifier.border(1.dp, scheme.outline, Pill))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(
                start = BallastSpacing.md,
                end = if (onClear != null) BallastSpacing.xs else BallastSpacing.md,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = content,
            maxLines = 1,
        )
        if (onClear != null) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Remove $text filter",
                modifier = Modifier
                    .size(20.dp)
                    .clip(Pill)
                    .clickable(onClick = onClear)
                    .padding(BallastSpacing.xs),
                tint = content,
            )
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun ChipGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastFilterChip(text = "This month", onClear = {})
                BallastFilterChip(text = "Expenses", onClear = {}, onClick = {})
            }
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastFilterChip(text = "Groceries", selected = false, onClick = {})
                BallastFilterChip(text = "Uncategorized", selected = false, onClear = {})
            }
        }
    }
}

@Preview(name = "Chips light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ChipLightPreview() {
    BallastTheme(darkTheme = false) { ChipGallery() }
}

@Preview(name = "Chips dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ChipDarkPreview() {
    BallastTheme(darkTheme = true) { ChipGallery() }
}
