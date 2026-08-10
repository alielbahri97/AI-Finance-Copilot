package com.ballastmoney.android.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastCardHeader
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The card every chart on the dashboard sits in.
 *
 * A single wrapper keeps the title/description/body rhythm identical across the
 * five cards, which matters more than it sounds: these are read as a set, and
 * one card with different padding reads as a bug.
 */
@Composable
fun ChartCard(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BallastCard(modifier = modifier.fillMaxWidth()) {
        BallastCardHeader(title = title, description = description)
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        content()
    }
}

/**
 * One entry in a chart legend.
 *
 * [dimmed] is how an account that exists but is not counted in the headline
 * total is shown: present, greyed, not hidden. Hiding it would make the total
 * unexplainable.
 */
data class LegendEntry(
    val label: String,
    val color: Color,
    val value: String? = null,
    val dimmed: Boolean = false,
)

/**
 * The stand-in for chart tooltips.
 *
 * Vico markers are deliberately not used anywhere in this package — see the
 * chart files — so the numbers a marker would have revealed are printed here
 * instead. It reads worse than a tooltip and works better with TalkBack.
 */
@Composable
fun ChartLegend(
    entries: List<LegendEntry>,
    modifier: Modifier = Modifier,
) {
    if (entries.isEmpty()) return
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        // Rough measure rather than real text measurement: legend labels are
        // short and a column that is a little generous beats one that clips.
        val perRow = ((maxWidth / LEGEND_ENTRY_MIN_WIDTH).toInt()).coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs)) {
            entries.chunked(perRow).forEach { rowEntries ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
                ) {
                    rowEntries.forEach { entry ->
                        LegendItem(entry = entry, modifier = Modifier.weight(1f))
                    }
                    repeat(perRow - rowEntries.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun LegendItem(
    entry: LegendEntry,
    modifier: Modifier = Modifier,
) {
    val muted = MaterialTheme.ballastColors.mutedForeground
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(
            modifier = Modifier
                .size(LEGEND_DOT_SIZE)
                .background(
                    color = if (entry.dimmed) entry.color.copy(alpha = DIMMED_ALPHA) else entry.color,
                    shape = CircleShape,
                ),
        )
        Spacer(modifier = Modifier.width(BallastSpacing.xs))
        Column {
            Text(
                text = entry.label,
                style = BallastTextStyles.micro,
                color = muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (entry.value != null) {
                Text(
                    text = entry.value,
                    style = BallastTextStyles.moneySm,
                    color = if (entry.dimmed) muted else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private val LEGEND_DOT_SIZE: Dp = 10.dp
private val LEGEND_ENTRY_MIN_WIDTH: Dp = 120.dp
private const val DIMMED_ALPHA = 0.4f
