package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/** The tint behind the icon tile. */
private const val ICON_TILE_ALPHA = 0.10f

/** Roughly 45 characters at 14sp, which is a comfortable measure for one column. */
private val ProseMaxWidth = 280.dp

/**
 * "Nothing here yet", with a way forward.
 *
 * Both actions are slots rather than text-plus-lambda pairs so a caller can put
 * whatever the screen needs there — usually a primary [BallastButton] and a
 * ghost or link secondary.
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    primaryAction: @Composable (() -> Unit)? = null,
    secondaryAction: @Composable (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(BallastSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .background(
                    MaterialTheme.colorScheme.primary.copy(alpha = ICON_TILE_ALPHA),
                    RoundedCornerShape(BallastRadius.xl),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.cardTitle,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Text(
                text = description,
                style = BallastTextStyles.mutedBody,
                color = MaterialTheme.ballastColors.mutedForeground,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = ProseMaxWidth),
            )
        }
        if (primaryAction != null || secondaryAction != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                primaryAction?.invoke()
                secondaryAction?.invoke()
            }
        }
    }
}

/**
 * Something failed. Distinct from [EmptyState] because the icon tile is
 * destructive-tinted — "no transactions yet" and "we could not load your
 * transactions" must not look the same.
 */
@Composable
fun ErrorState(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(BallastSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .background(
                    MaterialTheme.colorScheme.error.copy(alpha = ICON_TILE_ALPHA),
                    RoundedCornerShape(BallastRadius.xl),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.ballastColors.destructiveTinted,
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.cardTitle,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Text(
                text = description,
                style = BallastTextStyles.mutedBody,
                color = MaterialTheme.ballastColors.mutedForeground,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = ProseMaxWidth),
            )
        }
        if (onRetry != null) {
            BallastButton(
                text = "Try again",
                onClick = onRetry,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
            )
        }
    }
}

/** A centred spinner for a whole pane. Prefer a skeleton where the shape is known. */
@Composable
fun LoadingState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(BallastSpacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(28.dp),
            color = MaterialTheme.colorScheme.primary,
            strokeWidth = 3.dp,
        )
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun EmptyStateSample() {
    Surface(color = MaterialTheme.colorScheme.background) {
        EmptyState(
            icon = Icons.Filled.List,
            title = "No transactions yet",
            description = "Connect a bank account or import a CSV and everything you " +
                "spend will show up here.",
            primaryAction = {
                BallastButton(text = "Connect a bank", onClick = {}, size = ButtonSize.SMALL)
            },
            secondaryAction = {
                BallastButton(
                    text = "Import a file",
                    onClick = {},
                    variant = ButtonVariant.GHOST,
                    size = ButtonSize.SMALL,
                )
            },
        )
    }
}

@Composable
private fun ErrorStateSample() {
    Surface(color = MaterialTheme.colorScheme.background) {
        ErrorState(
            title = "Couldn't load your transactions",
            description = "The request timed out. Your data is safe — this is only " +
                "this screen.",
            onRetry = {},
        )
    }
}

@Preview(name = "Empty state light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun EmptyStateLightPreview() {
    BallastTheme(darkTheme = false) { EmptyStateSample() }
}

@Preview(name = "Empty state dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun EmptyStateDarkPreview() {
    BallastTheme(darkTheme = true) { EmptyStateSample() }
}

@Preview(name = "Error state light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ErrorStateLightPreview() {
    BallastTheme(darkTheme = false) { ErrorStateSample() }
}

@Preview(name = "Error state dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ErrorStateDarkPreview() {
    BallastTheme(darkTheme = true) { ErrorStateSample() }
}

@Preview(name = "Loading state", showBackground = true, backgroundColor = 0xFFF8FAFD, heightDp = 200)
@Composable
private fun LoadingStatePreview() {
    BallastTheme(darkTheme = false) {
        Surface(color = MaterialTheme.colorScheme.background) { LoadingState() }
    }
}
