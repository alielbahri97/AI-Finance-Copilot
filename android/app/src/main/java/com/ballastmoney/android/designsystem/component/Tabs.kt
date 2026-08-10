package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

private val TrackShape = RoundedCornerShape(BallastRadius.lg)
private val ThumbShape = RoundedCornerShape(BallastRadius.md)

/** `p-[3px]` on the web's `TabsList`. */
private val TrackPadding = 3.dp

/**
 * A segmented control, not an underlined `TabRow`.
 *
 * The web's tabs are a `muted` track with a raised pill on the active item, so
 * this is built from a [Row] rather than restyling Material's `TabRow`, whose
 * indicator is an underline and whose selected item is defined by a sliding
 * line. Reproducing the web treatment through `TabRow`'s indicator slot would be
 * more code than not using it.
 */
@Composable
fun BallastTabs(
    tabs: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .height(36.dp)
            .clip(TrackShape)
            .background(MaterialTheme.colorScheme.surfaceVariant, TrackShape)
            .padding(TrackPadding),
        horizontalArrangement = Arrangement.spacedBy(TrackPadding),
    ) {
        tabs.forEachIndexed { index, label ->
            val active = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(ThumbShape)
                    .background(
                        if (active) MaterialTheme.colorScheme.surface else Color.Transparent,
                        ThumbShape,
                    )
                    .clickable(role = Role.Tab) { onSelect(index) }
                    .padding(horizontal = BallastSpacing.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (active) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.ballastColors.mutedForeground
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun TabsGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            BallastTabs(
                tabs = listOf("Overview", "Transactions", "Settings"),
                selectedIndex = 0,
                onSelect = {},
            )
            BallastTabs(
                tabs = listOf("All", "Income", "Expenses"),
                selectedIndex = 2,
                onSelect = {},
            )
            BallastTabs(
                tabs = listOf("Month", "Quarter"),
                selectedIndex = 1,
                onSelect = {},
            )
        }
    }
}

@Preview(name = "Tabs light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun TabsLightPreview() {
    BallastTheme(darkTheme = false) { TabsGallery() }
}

@Preview(name = "Tabs dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun TabsDarkPreview() {
    BallastTheme(darkTheme = true) { TabsGallery() }
}
