package com.ballastmoney.android.designsystem.component

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill

private const val PULSE_MIN_ALPHA = 0.45f
private const val PULSE_DURATION_MS = 1000

/**
 * A placeholder block.
 *
 * The pulse is a slow alpha ramp rather than a shimmer sweep: a sweep across
 * several placeholders needs them to share one animation clock to look right, and
 * every skeleton here is composed independently.
 */
@Composable
fun Skeleton(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(BallastRadius.sm),
) {
    val transition = rememberInfiniteTransition(label = "skeletonPulse")
    val alpha by transition.animateFloat(
        initialValue = PULSE_MIN_ALPHA,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = PULSE_DURATION_MS, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "skeletonAlpha",
    )
    Box(
        modifier = modifier.background(
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = alpha),
            shape,
        )
    )
}

/**
 * Stand-in for a paragraph. The last line is short so the block reads as prose
 * rather than as a table.
 */
@Composable
fun SkeletonText(
    modifier: Modifier = Modifier,
    lines: Int = 1,
    lastLineFraction: Float = 0.6f,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        repeat(lines) { index ->
            val isLast = index == lines - 1
            Skeleton(
                modifier = Modifier
                    .fillMaxWidth(if (isLast && lines > 1) lastLineFraction else 1f)
                    .height(12.dp)
            )
        }
    }
}

/** The loading form of a KPI tile: eyebrow label, then a large figure. */
@Composable
fun StatCardSkeleton(modifier: Modifier = Modifier) {
    BallastCard(modifier = modifier) {
        Skeleton(modifier = Modifier.width(88.dp).height(10.dp))
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        Skeleton(modifier = Modifier.width(140.dp).height(28.dp))
        Spacer(modifier = Modifier.height(BallastSpacing.sm))
        Skeleton(modifier = Modifier.width(64.dp).height(10.dp))
    }
}

/** The loading form of a chart card: heading, then the plot area. */
@Composable
fun ChartCardSkeleton(modifier: Modifier = Modifier) {
    BallastCard(modifier = modifier) {
        Skeleton(modifier = Modifier.width(120.dp).height(14.dp))
        Spacer(modifier = Modifier.height(BallastSpacing.sm))
        Skeleton(modifier = Modifier.width(180.dp).height(10.dp))
        Spacer(modifier = Modifier.height(BallastSpacing.lg))
        Skeleton(
            modifier = Modifier.fillMaxWidth().height(180.dp),
            shape = RoundedCornerShape(BallastRadius.md),
        )
    }
}

/** The loading form of a transaction list. */
@Composable
fun ListRowSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = 6,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        repeat(rows) { index ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = BallastSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Skeleton(modifier = Modifier.size(32.dp), shape = Pill)
                Spacer(modifier = Modifier.width(BallastSpacing.md))
                Column(
                    modifier = Modifier.width(160.dp),
                    verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
                ) {
                    Skeleton(modifier = Modifier.fillMaxWidth().height(12.dp))
                    Skeleton(modifier = Modifier.fillMaxWidth(0.55f).height(10.dp))
                }
                Spacer(modifier = Modifier.weight(1f))
                Skeleton(modifier = Modifier.width(72.dp).height(14.dp))
            }
            if (index < rows - 1) {
                BallastSeparator()
            }
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun SkeletonGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md)) {
                StatCardSkeleton(modifier = Modifier.weight(1f))
                StatCardSkeleton(modifier = Modifier.weight(1f))
            }
            ChartCardSkeleton()
            BallastCard(contentPadding = PaddingValues(vertical = BallastSpacing.sm)) {
                ListRowSkeleton(rows = 4)
            }
            SkeletonText(lines = 3)
        }
    }
}

@Preview(name = "Skeletons light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun SkeletonLightPreview() {
    BallastTheme(darkTheme = false) { SkeletonGallery() }
}

@Preview(name = "Skeletons dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun SkeletonDarkPreview() {
    BallastTheme(darkTheme = true) { SkeletonGallery() }
}
