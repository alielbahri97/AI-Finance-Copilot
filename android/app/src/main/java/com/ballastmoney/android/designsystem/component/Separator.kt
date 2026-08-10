package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/** A hairline rule, at the same weight as a card's border. */
@Composable
fun BallastSeparator(
    modifier: Modifier = Modifier,
    vertical: Boolean = false,
) {
    val color = MaterialTheme.ballastColors.cardBorder
    if (vertical) {
        VerticalDivider(modifier = modifier, thickness = 1.dp, color = color)
    } else {
        HorizontalDivider(modifier = modifier, thickness = 1.dp, color = color)
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun SeparatorGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Text(text = "Above", style = MaterialTheme.typography.bodyMedium)
            BallastSeparator()
            Text(text = "Below", style = MaterialTheme.typography.bodyMedium)
            Row(
                modifier = Modifier.height(24.dp),
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
            ) {
                Text(text = "Left", style = MaterialTheme.typography.bodyMedium)
                BallastSeparator(vertical = true)
                Text(text = "Right", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Preview(name = "Separator light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun SeparatorLightPreview() {
    BallastTheme(darkTheme = false) { SeparatorGallery() }
}

@Preview(name = "Separator dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun SeparatorDarkPreview() {
    BallastTheme(darkTheme = true) { SeparatorGallery() }
}
