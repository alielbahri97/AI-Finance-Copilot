package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

enum class BadgeVariant { DEFAULT, SECONDARY, OUTLINE, DESTRUCTIVE, SUCCESS, WARNING }

private val BadgeShape = RoundedCornerShape(BallastRadius.md)

/** The wash behind SUCCESS and WARNING badges. */
private const val TINT_ALPHA = 0.10f

private class BadgePalette(
    val container: Color,
    val content: Color,
    val border: Color?,
)

/**
 * A status pill.
 *
 * SUCCESS and WARNING print a darkened variant of their hue on a 10% wash of the
 * base — the web holds the wash at 10% in dark mode too, because at 20% the chip
 * lifted close enough to its own text to drop both badges under 3.6:1.
 */
@Composable
fun BallastBadge(
    text: String,
    modifier: Modifier = Modifier,
    variant: BadgeVariant = BadgeVariant.DEFAULT,
    leadingIcon: ImageVector? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors

    val palette = when (variant) {
        BadgeVariant.DEFAULT -> BadgePalette(scheme.primary, scheme.onPrimary, null)
        BadgeVariant.SECONDARY -> BadgePalette(scheme.secondary, scheme.onSecondary, null)
        BadgeVariant.OUTLINE -> BadgePalette(Color.Transparent, scheme.onBackground, scheme.outline)
        BadgeVariant.DESTRUCTIVE -> BadgePalette(extended.destructiveSolid, Color.White, null)
        BadgeVariant.SUCCESS -> BadgePalette(
            container = extended.success.copy(alpha = TINT_ALPHA),
            content = extended.successTinted,
            border = null,
        )
        BadgeVariant.WARNING -> BadgePalette(
            container = extended.warning.copy(alpha = TINT_ALPHA),
            content = extended.warningTinted,
            border = null,
        )
    }
    val content = palette.content

    Row(
        modifier = modifier
            .background(palette.container, BadgeShape)
            .then(
                palette.border?.let { Modifier.border(1.dp, it, BadgeShape) } ?: Modifier
            )
            .padding(horizontal = BallastSpacing.sm, vertical = BallastSpacing.xxs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        if (leadingIcon != null) {
            Icon(
                imageVector = leadingIcon,
                contentDescription = null,
                modifier = Modifier.size(12.dp),
                tint = content,
            )
        }
        Text(
            text = text,
            style = BallastTextStyles.micro,
            color = content,
            maxLines = 1,
        )
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun BadgeGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastBadge(text = "Business")
                BallastBadge(text = "Draft", variant = BadgeVariant.SECONDARY)
                BallastBadge(text = "Uncategorized", variant = BadgeVariant.OUTLINE)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastBadge(text = "Overdue", variant = BadgeVariant.DESTRUCTIVE)
                BallastBadge(
                    text = "Reconciled",
                    variant = BadgeVariant.SUCCESS,
                    leadingIcon = Icons.Filled.Check,
                )
                BallastBadge(
                    text = "Needs review",
                    variant = BadgeVariant.WARNING,
                    leadingIcon = Icons.Filled.Warning,
                )
            }
        }
    }
}

@Preview(name = "Badges light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BadgeLightPreview() {
    BallastTheme(darkTheme = false) { BadgeGallery() }
}

@Preview(name = "Badges dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun BadgeDarkPreview() {
    BallastTheme(darkTheme = true) { BadgeGallery() }
}
