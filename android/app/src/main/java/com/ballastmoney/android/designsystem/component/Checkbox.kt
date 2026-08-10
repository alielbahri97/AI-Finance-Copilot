package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme

/** Row selection in the transactions table, and consent boxes in forms. */
@Composable
fun BallastCheckbox(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val scheme = MaterialTheme.colorScheme
    Checkbox(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors = CheckboxDefaults.colors(
            checkedColor = scheme.primary,
            uncheckedColor = scheme.outline,
            checkmarkColor = scheme.onPrimary,
            disabledCheckedColor = scheme.primary.copy(alpha = 0.5f),
            disabledUncheckedColor = scheme.outline.copy(alpha = 0.5f),
            disabledIndeterminateColor = scheme.primary.copy(alpha = 0.5f),
        ),
    )
}

// --- Previews --------------------------------------------------------------

@Composable
private fun CheckboxGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            ) {
                BallastCheckbox(checked = true, onCheckedChange = {})
                Text(text = "Selected", style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            ) {
                BallastCheckbox(checked = false, onCheckedChange = {})
                Text(text = "Not selected", style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            ) {
                BallastCheckbox(checked = true, onCheckedChange = {}, enabled = false)
                Text(text = "Locked", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Preview(name = "Checkbox light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun CheckboxLightPreview() {
    BallastTheme(darkTheme = false) { CheckboxGallery() }
}

@Preview(name = "Checkbox dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun CheckboxDarkPreview() {
    BallastTheme(darkTheme = true) { CheckboxGallery() }
}
