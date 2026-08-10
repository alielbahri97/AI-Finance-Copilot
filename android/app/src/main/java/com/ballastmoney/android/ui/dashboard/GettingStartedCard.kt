package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The zero-data state: what to do first, in the order that works best.
 *
 * This replaces the entire body rather than sitting above empty charts. Eight
 * cards that all say "no data" teach nothing; one card that says "connect a
 * bank" teaches the next step. The order is deliberate — a bank connection
 * keeps working by itself, a statement import is a one-off, and a manual entry
 * is only there to show what a transaction looks like.
 */
@Composable
fun GettingStartedCard(
    edition: WorkspaceType,
    canEditTransactions: Boolean,
    onConnectBank: () -> Unit,
    onUploadStatement: () -> Unit,
    onAddManually: () -> Unit,
    onLearnAboutImporting: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BallastCard(modifier = modifier.fillMaxWidth()) {
        Text(text = DashboardCopy.GETTING_STARTED_TITLE, style = BallastTextStyles.cardTitle)
        Spacer(modifier = Modifier.height(BallastSpacing.xs))
        Text(
            text = DashboardCopy.gettingStartedDescription(edition),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        Spacer(modifier = Modifier.height(BallastSpacing.lg))

        if (canEditTransactions) {
            GettingStartedTiles(
                onConnectBank = onConnectBank,
                onUploadStatement = onUploadStatement,
                onAddManually = onAddManually,
            )
        } else {
            // Nothing on offer would work for this user, so the tiles are not
            // shown at all — an explanation is more use than three dead ends.
            Text(
                text = DashboardCopy.GETTING_STARTED_NO_PERMISSION,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
            Spacer(modifier = Modifier.height(BallastSpacing.md))
            BallastButton(
                text = DashboardCopy.HOW_IMPORTING_WORKS,
                onClick = onLearnAboutImporting,
                variant = ButtonVariant.OUTLINE,
            )
        }
    }
}

@Composable
private fun GettingStartedTiles(
    onConnectBank: () -> Unit,
    onUploadStatement: () -> Unit,
    onAddManually: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val tiles = listOf<@Composable (Modifier) -> Unit>(
            { tileModifier ->
                GettingStartedTile(
                    title = DashboardCopy.TILE_BANK_TITLE,
                    body = DashboardCopy.TILE_BANK_BODY,
                    isPrimary = true,
                    onClick = onConnectBank,
                    modifier = tileModifier,
                )
            },
            { tileModifier ->
                GettingStartedTile(
                    title = DashboardCopy.TILE_STATEMENT_TITLE,
                    body = DashboardCopy.TILE_STATEMENT_BODY,
                    isPrimary = false,
                    onClick = onUploadStatement,
                    modifier = tileModifier,
                )
            },
            { tileModifier ->
                GettingStartedTile(
                    title = DashboardCopy.TILE_MANUAL_TITLE,
                    body = DashboardCopy.TILE_MANUAL_BODY,
                    isPrimary = false,
                    onClick = onAddManually,
                    modifier = tileModifier,
                )
            },
        )
        if (maxWidth < TILE_ROW_MIN_WIDTH) {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                tiles.forEach { tile -> tile(Modifier.fillMaxWidth()) }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                tiles.forEach { tile ->
                    Column(modifier = Modifier.weight(1f)) { tile(Modifier.fillMaxWidth()) }
                }
            }
        }
    }
}

@Composable
private fun GettingStartedTile(
    title: String,
    body: String,
    isPrimary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val shape = RoundedCornerShape(BallastRadius.md)
    val emphasis = if (isPrimary) {
        Modifier.background(colors.sidebarAccent)
    } else {
        Modifier.border(width = 1.dp, color = colors.cardBorder, shape = shape)
    }
    Column(
        modifier = modifier
            .clip(shape)
            .then(emphasis)
            .clickable(onClick = onClick)
            .padding(BallastSpacing.md),
    ) {
        Text(
            text = title,
            style = BallastTextStyles.cardTitle,
            color = if (isPrimary) {
                colors.sidebarAccentForeground
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
        Spacer(modifier = Modifier.height(BallastSpacing.xxs))
        Text(
            text = body,
            style = BallastTextStyles.micro,
            color = if (isPrimary) colors.sidebarAccentForeground else colors.mutedForeground,
        )
    }
}

/** Below this the three tiles stack instead of sharing a row. */
private val TILE_ROW_MIN_WIDTH = 560.dp
