package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/** `rounded-xl`, which the shadcn scale derives as `--radius + 4px`, so 16dp. */
private val CardShape = RoundedCornerShape(BallastRadius.xl)

/**
 * The container everything on a dashboard sits in.
 *
 * The web card is flat: a hairline border at 60% of the border token and
 * `shadow-xs`, no tonal fill. Material's default `Card` elevation would tint the
 * surface and cast a real shadow, so this restyles [Surface] instead — 1dp of
 * shadow is enough to lift the card off the page background without turning the
 * screen into a stack of floating panels.
 */
@Composable
fun BallastCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(BallastSpacing.lg),
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 0.dp,
        shadowElevation = 1.dp,
        border = BorderStroke(1.dp, MaterialTheme.ballastColors.cardBorder),
    ) {
        Column(
            // Inside the Surface rather than on it, so the ripple is clipped to
            // the card's corners.
            modifier = Modifier
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(contentPadding),
            content = content,
        )
    }
}

/**
 * Title, optional supporting line, and an optional trailing control — the web's
 * `CardHeader` + `CardAction` pair.
 */
@Composable
fun BallastCardHeader(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    action: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.cardTitle,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
        }
        if (action != null) {
            action()
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun CardGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            BallastCard {
                BallastCardHeader(
                    title = "Cash position",
                    description = "Across 4 connected accounts",
                    action = {
                        BallastButton(
                            text = "View",
                            onClick = {},
                            variant = ButtonVariant.LINK,
                            size = ButtonSize.SMALL,
                        )
                    },
                )
                Text(
                    text = "Updated 3 minutes ago",
                    style = BallastTextStyles.micro,
                    color = MaterialTheme.ballastColors.mutedForeground,
                    modifier = Modifier.padding(top = BallastSpacing.md),
                )
            }
            BallastCard(onClick = {}) {
                BallastCardHeader(title = "Tappable card")
                Text(
                    text = "The whole surface is a target.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.ballastColors.mutedForeground,
                    modifier = Modifier.padding(top = BallastSpacing.sm),
                )
            }
        }
    }
}

@Preview(name = "Card light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun CardLightPreview() {
    BallastTheme(darkTheme = false) { CardGallery() }
}

@Preview(name = "Card dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun CardDarkPreview() {
    BallastTheme(darkTheme = true) { CardGallery() }
}
