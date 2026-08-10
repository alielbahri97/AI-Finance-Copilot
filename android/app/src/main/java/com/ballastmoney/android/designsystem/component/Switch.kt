package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * A Material switch on the Ballast palette.
 *
 * The unchecked track is `muted` with a `border`-coloured outline rather than
 * Material's `surfaceVariant`-on-`outline`, which reads as a disabled control
 * against a card.
 */
@Composable
fun BallastSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedThumbColor = scheme.onPrimary,
            checkedTrackColor = scheme.primary,
            checkedBorderColor = scheme.primary,
            uncheckedThumbColor = extended.mutedForeground,
            uncheckedTrackColor = scheme.surfaceVariant,
            uncheckedBorderColor = scheme.outline,
            disabledCheckedThumbColor = scheme.onPrimary.copy(alpha = 0.5f),
            disabledCheckedTrackColor = scheme.primary.copy(alpha = 0.5f),
            disabledCheckedBorderColor = Color.Transparent,
            disabledUncheckedThumbColor = extended.mutedForeground.copy(alpha = 0.5f),
            disabledUncheckedTrackColor = scheme.surfaceVariant.copy(alpha = 0.5f),
            disabledUncheckedBorderColor = scheme.outline.copy(alpha = 0.5f),
        ),
    )
}

// --- Previews --------------------------------------------------------------

@Composable
private fun SwitchGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
            ) {
                BallastSwitch(checked = true, onCheckedChange = {})
                Text(text = "On", style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
            ) {
                BallastSwitch(checked = false, onCheckedChange = {})
                Text(text = "Off", style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
            ) {
                BallastSwitch(checked = true, onCheckedChange = {}, enabled = false)
                BallastSwitch(checked = false, onCheckedChange = {}, enabled = false)
                Text(text = "Disabled", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Preview(name = "Switch light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun SwitchLightPreview() {
    BallastTheme(darkTheme = false) { SwitchGallery() }
}

@Preview(name = "Switch dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun SwitchDarkPreview() {
    BallastTheme(darkTheme = true) { SwitchGallery() }
}
