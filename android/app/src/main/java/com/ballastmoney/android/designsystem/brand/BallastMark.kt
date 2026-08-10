package com.ballastmoney.android.designsystem.brand

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme

/**
 * Subpaths of the Ballast mark, copied verbatim from `src/lib/brand/mark.ts`.
 *
 * They are kept as SVG path strings rather than transcribed into
 * `ImageVector.Builder` calls so the two clients cannot drift: a diff against
 * the web file is a string comparison. [PathParser] does the conversion.
 *
 * The mark is a balance weight — two stacked horizontal capsules of decreasing
 * length above a stem and a ballast bulb — and its visual weight sits low on
 * purpose. All four subpaths are wound the same way so a nonzero fill unions
 * them into one silhouette; the stem overlaps the middle bar so the seam closes.
 */
private val MARK_PATHS: List<String> = listOf(
    // Top bar: longest capsule, height 2.2, radius 1.1.
    "M4.6 5 H19.4 C20.0075 5 20.5 5.4925 20.5 6.1 C20.5 6.7075 20.0075 7.2 19.4 7.2 H4.6 C3.9925 7.2 3.5 6.7075 3.5 6.1 C3.5 5.4925 3.9925 5 4.6 5 Z",
    // Middle bar: shorter capsule, same thickness, gap ~ bar height.
    "M7.6 9.2 H16.4 C17.0075 9.2 17.5 9.6925 17.5 10.3 C17.5 10.9075 17.0075 11.4 16.4 11.4 H7.6 C6.9925 11.4 6.5 10.9075 6.5 10.3 C6.5 9.6925 6.9925 9.2 7.6 9.2 Z",
    // Stem: thin connector into the bulb.
    "M11.35 11 H12.65 V15.4 H11.35 Z",
    // Ballast bulb: circle of radius 2.9 centred at (12, 18.3).
    "M14.9 18.3 C14.9 19.9017 13.6017 21.2 12 21.2 C10.3983 21.2 9.1 19.9017 9.1 18.3 C9.1 16.6983 10.3983 15.4 12 15.4 C13.6017 15.4 14.9 16.6983 14.9 18.3 Z",
)

private var markCache: ImageVector? = null

/**
 * The Ballast mark as an [ImageVector], on the 24x24 icon grid.
 *
 * Unlike the web SVG, which crops the view box to the mark's exact bounding box
 * so a square element letterboxes it, this keeps the full 24x24 viewport. That
 * makes it line up with every other 24dp icon in a bottom bar or app bar, which
 * matters more here than filling the box edge to edge.
 *
 * Built once and cached, the same way `androidx.compose.material.icons` does.
 */
val BallastMark: ImageVector
    get() = markCache ?: buildMark().also { markCache = it }

private fun buildMark(): ImageVector {
    val builder = ImageVector.Builder(
        name = "BallastMark",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    )
    MARK_PATHS.forEach { pathData ->
        builder.addPath(
            pathData = PathParser().parsePathString(pathData).toNodes(),
            pathFillType = PathFillType.NonZero,
            // Black is the convention for tintable vectors; `Icon` replaces it
            // with a colour filter, and `tint` is what callers actually control.
            fill = SolidColor(Color.Black),
        )
    }
    return builder.build()
}

/**
 * The mark, optionally followed by the wordmark.
 *
 * [size] applies to the mark only — the wordmark keeps its own type size so the
 * lockup stays legible when the mark is scaled up.
 */
@Composable
fun BallastLogo(
    modifier: Modifier = Modifier,
    size: Dp = 24.dp,
    tint: Color = MaterialTheme.colorScheme.primary,
    showWordmark: Boolean = false,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        Icon(
            imageVector = BallastMark,
            // The wordmark next to it already says "Ballast"; announcing it
            // twice is noise.
            contentDescription = if (showWordmark) null else "Ballast",
            modifier = Modifier.size(size),
            tint = tint,
        )
        if (showWordmark) {
            Text(
                text = "Ballast",
                style = BallastTextStyles.sectionTitle,
                color = tint,
            )
        }
    }
}

// --- Previews --------------------------------------------------------------

@Preview(name = "Logo light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BallastLogoLightPreview() {
    BallastTheme(darkTheme = false) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Row(
                modifier = Modifier.size(width = 260.dp, height = 96.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xl),
            ) {
                BallastLogo(size = 24.dp)
                BallastLogo(size = 40.dp)
                BallastLogo(showWordmark = true)
            }
        }
    }
}

@Preview(name = "Logo dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun BallastLogoDarkPreview() {
    BallastTheme(darkTheme = true) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Row(
                modifier = Modifier.size(width = 260.dp, height = 96.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xl),
            ) {
                BallastLogo(size = 24.dp)
                BallastLogo(size = 40.dp)
                BallastLogo(showWordmark = true)
            }
        }
    }
}
