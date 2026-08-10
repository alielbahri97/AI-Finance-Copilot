package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
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

enum class AlertVariant { DEFAULT, DESTRUCTIVE, WARNING }

private val AlertShape = RoundedCornerShape(BallastRadius.lg)

/** The same 10% wash the tinted badges use, so a page reads as one system. */
private const val WASH_ALPHA = 0.10f
private const val BORDER_ALPHA = 0.30f

private class AlertPalette(
    val container: Color,
    val accent: Color,
    val border: Color,
)

/**
 * An inline notice: a failed sync, a plan limit, a bank connection that needs
 * re-authorising.
 *
 * DEFAULT is a card rather than a tinted panel, because most notices in the app
 * are informational and a blue wash on every one of them would spend attention
 * the destructive and warning variants need.
 */
@Composable
fun BallastAlert(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    variant: AlertVariant = AlertVariant.DEFAULT,
    icon: ImageVector? = null,
    action: @Composable (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors

    val palette = when (variant) {
        AlertVariant.DEFAULT -> AlertPalette(
            container = scheme.surface,
            accent = scheme.primary,
            border = extended.cardBorder,
        )
        AlertVariant.DESTRUCTIVE -> AlertPalette(
            container = scheme.error.copy(alpha = WASH_ALPHA),
            accent = extended.destructiveTinted,
            border = scheme.error.copy(alpha = BORDER_ALPHA),
        )
        AlertVariant.WARNING -> AlertPalette(
            container = extended.warning.copy(alpha = WASH_ALPHA),
            accent = extended.warningTinted,
            border = extended.warning.copy(alpha = BORDER_ALPHA),
        )
    }
    val accent = palette.accent

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AlertShape,
        color = palette.container,
        tonalElevation = 0.dp,
        border = BorderStroke(1.dp, palette.border),
    ) {
        Row(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalAlignment = Alignment.Top,
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = accent,
                )
                Spacer(modifier = Modifier.width(BallastSpacing.md))
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = if (variant == AlertVariant.DEFAULT) scheme.onSurface else accent,
                )
                if (description != null) {
                    Text(
                        text = description,
                        style = BallastTextStyles.mutedBody,
                        color = extended.mutedForeground,
                    )
                }
                if (action != null) {
                    Spacer(modifier = Modifier.height(BallastSpacing.xs))
                    action()
                }
            }
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun AlertGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            BallastAlert(
                title = "Sandbox data",
                description = "This workspace is connected to a test bank, so the " +
                    "balances below are not real.",
                icon = Icons.Filled.Info,
            )
            BallastAlert(
                title = "Monzo needs reconnecting",
                description = "Your bank's consent expired on 4 August. Reconnect to " +
                    "resume daily imports.",
                variant = AlertVariant.WARNING,
                icon = Icons.Filled.Warning,
                action = {
                    BallastButton(
                        text = "Reconnect",
                        onClick = {},
                        variant = ButtonVariant.OUTLINE,
                        size = ButtonSize.SMALL,
                    )
                },
            )
            BallastAlert(
                title = "Last sync failed",
                description = "The provider returned a rate limit. Ballast will retry " +
                    "automatically in an hour.",
                variant = AlertVariant.DESTRUCTIVE,
                icon = Icons.Filled.Warning,
            )
        }
    }
}

@Preview(name = "Alerts light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun AlertLightPreview() {
    BallastTheme(darkTheme = false) { AlertGallery() }
}

@Preview(name = "Alerts dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun AlertDarkPreview() {
    BallastTheme(darkTheme = true) { AlertGallery() }
}
