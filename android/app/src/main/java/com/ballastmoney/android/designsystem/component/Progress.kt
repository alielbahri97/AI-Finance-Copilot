package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill
import com.ballastmoney.android.designsystem.theme.ballastColors

enum class ProgressTone { DEFAULT, SUCCESS, WARNING, DESTRUCTIVE }

/** `h-2` on the web. */
private val TrackHeight = 8.dp

/**
 * A determinate bar for budgets, goals and plan usage.
 *
 * [progress] is a fraction from 0 to 1 (Android's convention), not the 0–100 the
 * web component takes. Values outside the range are clamped for drawing but
 * reported to assistive technology as given, so "112% of budget" is still
 * announced honestly.
 *
 * [label] is the accessible name and is not drawn — a bare bar means nothing on
 * its own, so callers must supply one, but the visible text is usually a heading
 * the bar sits under.
 *
 * Built from boxes rather than `LinearProgressIndicator`: the web bar is a plain
 * fully-rounded track with no stop indicator and no gap before the fill, and
 * suppressing both of Material's is more work than drawing two rectangles.
 */
@Composable
fun BallastProgress(
    progress: Float,
    label: String,
    modifier: Modifier = Modifier,
    tone: ProgressTone = ProgressTone.DEFAULT,
) {
    val extended = MaterialTheme.ballastColors
    val fillColor = when (tone) {
        ProgressTone.DEFAULT -> MaterialTheme.colorScheme.primary
        ProgressTone.SUCCESS -> extended.success
        ProgressTone.WARNING -> extended.warning
        ProgressTone.DESTRUCTIVE -> MaterialTheme.colorScheme.error
    }
    val clamped = progress.coerceIn(0f, 1f)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(TrackHeight)
            .clip(Pill)
            .background(MaterialTheme.colorScheme.surfaceVariant, Pill)
            .semantics {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(
                    current = progress,
                    range = 0f..1f,
                )
            }
    ) {
        if (clamped > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(clamped)
                    .fillMaxHeight()
                    .background(fillColor, Pill)
            )
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun ProgressGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                Text(
                    text = "Groceries · 42% of $600",
                    style = MaterialTheme.typography.bodyMedium,
                )
                BallastProgress(progress = 0.42f, label = "Groceries budget used")
            }
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                Text(text = "Emergency fund · on track", style = MaterialTheme.typography.bodyMedium)
                BallastProgress(
                    progress = 0.78f,
                    label = "Emergency fund progress",
                    tone = ProgressTone.SUCCESS,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                Text(text = "Travel · close to limit", style = MaterialTheme.typography.bodyMedium)
                BallastProgress(
                    progress = 0.91f,
                    label = "Travel budget used",
                    tone = ProgressTone.WARNING,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                Text(text = "Dining · over budget", style = MaterialTheme.typography.bodyMedium)
                BallastProgress(
                    progress = 1.12f,
                    label = "Dining budget used",
                    tone = ProgressTone.DESTRUCTIVE,
                )
            }
            BallastProgress(progress = 0f, label = "Not started")
        }
    }
}

@Preview(name = "Progress light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ProgressLightPreview() {
    BallastTheme(darkTheme = false) { ProgressGallery() }
}

@Preview(name = "Progress dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ProgressDarkPreview() {
    BallastTheme(darkTheme = true) { ProgressGallery() }
}
