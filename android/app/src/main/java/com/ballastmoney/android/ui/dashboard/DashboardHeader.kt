package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastIconButton
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Greeting, subtitle and the page-level actions.
 *
 * The refresh control lives here rather than being a pull-to-refresh gesture.
 * Material 3's `PullToRefreshBox` is the obvious fit, but it has moved between
 * experimental and stable across recent Material 3 releases and this module
 * cannot be compiled yet to find out which it is on Compose 1.11. An explicit
 * button is dull and correct; swapping it for the gesture later is a change to
 * this file and [DashboardScreen] only.
 */
@Composable
fun DashboardHeader(
    greeting: String,
    subtitle: String,
    canAddTransaction: Boolean,
    isRefreshing: Boolean,
    onAddTransaction: () -> Unit,
    onImport: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val stacked = maxWidth < HEADER_ROW_MIN_WIDTH
        if (stacked) {
            Column(modifier = Modifier.fillMaxWidth()) {
                HeaderTitles(greeting = greeting, subtitle = subtitle)
                Spacer(modifier = Modifier.height(BallastSpacing.md))
                HeaderActions(
                    canAddTransaction = canAddTransaction,
                    isRefreshing = isRefreshing,
                    onAddTransaction = onAddTransaction,
                    onImport = onImport,
                    onRefresh = onRefresh,
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HeaderTitles(
                    greeting = greeting,
                    subtitle = subtitle,
                    modifier = Modifier.weight(1f),
                )
                HeaderActions(
                    canAddTransaction = canAddTransaction,
                    isRefreshing = isRefreshing,
                    onAddTransaction = onAddTransaction,
                    onImport = onImport,
                    onRefresh = onRefresh,
                )
            }
        }
    }
}

@Composable
private fun HeaderTitles(
    greeting: String,
    subtitle: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(text = greeting, style = BallastTextStyles.pageTitle)
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }
}

@Composable
private fun HeaderActions(
    canAddTransaction: Boolean,
    isRefreshing: Boolean,
    onAddTransaction: () -> Unit,
    onImport: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Gated, not disabled: a VIEWER should not be told about an action they
        // can never take.
        if (canAddTransaction) {
            BallastButton(
                text = DashboardCopy.ADD_TRANSACTION,
                onClick = onAddTransaction,
                variant = ButtonVariant.PRIMARY,
                size = ButtonSize.SMALL,
            )
        }
        BallastButton(
            text = DashboardCopy.IMPORT,
            onClick = onImport,
            variant = ButtonVariant.OUTLINE,
            size = ButtonSize.SMALL,
        )
        BallastIconButton(
            icon = Icons.Filled.Refresh,
            contentDescription = DashboardCopy.REFRESH,
            onClick = onRefresh,
            enabled = !isRefreshing,
        )
    }
}

/** Below this the actions wrap under the greeting instead of sitting beside it. */
private val HEADER_ROW_MIN_WIDTH = 520.dp
