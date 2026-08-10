package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/** The heading above a group of cards or rows on a screen. */
@Composable
fun SectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    action: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.sectionTitle,
                color = MaterialTheme.colorScheme.onBackground,
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
private fun SectionHeadingGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.xl),
        ) {
            SectionHeading(title = "Recent activity")
            SectionHeading(
                title = "Connected accounts",
                description = "4 banks, last synced 3 minutes ago",
                action = {
                    BallastButton(
                        text = "Sync all",
                        onClick = {},
                        variant = ButtonVariant.OUTLINE,
                        size = ButtonSize.SMALL,
                    )
                },
            )
            Text(
                text = "This month".uppercase(),
                style = BallastTextStyles.sectionLabel,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        }
    }
}

@Preview(name = "Section heading light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun SectionHeadingLightPreview() {
    BallastTheme(darkTheme = false) { SectionHeadingGallery() }
}

@Preview(name = "Section heading dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun SectionHeadingDarkPreview() {
    BallastTheme(darkTheme = true) { SectionHeadingGallery() }
}
