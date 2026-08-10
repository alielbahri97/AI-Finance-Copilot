package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.LockedReason
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme

/**
 * The states worth looking at without a device: everything healthy, everything
 * broken, and the three walls a user can hit.
 *
 * The fixtures carry a fixed clock, so "expires in 5 days" says five days in
 * every screenshot rather than counting down until the preview stops matching
 * the copy it was written to check.
 */

@Preview(name = "Banks connected", showBackground = true, heightDp = 1500)
@Composable
private fun AccountsBanksConnectedPreview() {
    PreviewScreen(AccountsPreviewData.ready())
}

@Preview(name = "Banks connected — tablet", showBackground = true, widthDp = 840, heightDp = 1100)
@Composable
private fun AccountsBanksConnectedTabletPreview() {
    PreviewScreen(AccountsPreviewData.ready())
}

@Preview(name = "Connection in error", showBackground = true, heightDp = 1500)
@Composable
private fun AccountsConnectionErrorPreview() {
    PreviewScreen(
        AccountsPreviewData.ready(
            connections = listOf(AccountsPreviewData.ing, AccountsPreviewData.rabobankErrored),
        ),
    )
}

/**
 * An expired connection and, beside it, a healthy one whose consent runs out in
 * five days. Both have to be here: the consent warning is deliberately not
 * shown on an expired connection, which already says its access is gone, so a
 * single connection could never show both states at once.
 */
@Preview(name = "Expired + consent warning", showBackground = true, heightDp = 1500)
@Composable
private fun AccountsExpiredConsentPreview() {
    PreviewScreen(
        AccountsPreviewData.ready(
            connections = listOf(
                AccountsPreviewData.kbcExpiringConsent,
                AccountsPreviewData.bunqExpired,
            ),
        ),
    )
}

@Preview(name = "Plan locked", showBackground = true, heightDp = 1200)
@Composable
private fun AccountsPlanLockedPreview() {
    PreviewScreen(
        AccountsPreviewData.ready(
            connections = emptyList(),
            lockedReason = LockedReason.UPGRADE_REQUIRED,
        ),
    )
}

@Preview(name = "Nothing connected", showBackground = true, heightDp = 1200)
@Composable
private fun AccountsEmptyPreview() {
    PreviewScreen(AccountsPreviewData.ready(connections = emptyList()))
}

@Preview(name = "Loading", showBackground = true, heightDp = 700)
@Composable
private fun AccountsLoadingPreview() {
    PreviewScreen(AccountsUiState.Loading)
}

@Preview(name = "No permission", showBackground = true, heightDp = 500)
@Composable
private fun AccountsNoPermissionPreview() {
    PreviewScreen(
        AccountsUiState.Error(
            message = "You do not have access to banks and accounts in this workspace. " +
                "Ask an owner or admin for the Manage integrations permission.",
            retryable = false,
        ),
    )
}

/**
 * The provider sheet's body for a provider the server has no credentials for.
 * Previewed without its sheet, which is a separate window and renders empty
 * here.
 */
@Preview(name = "Provider not configured", showBackground = true, heightDp = 400)
@Composable
private fun ProviderNotConfiguredPreview() {
    BallastTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            val formatters = remember {
                MoneyFormatterCache(MoneyFormatter("EUR"), "EUR")
            }
            ProviderDetailBody(
                provider = AccountsPreviewData.tink.copy(configured = false),
                connections = emptyList(),
                locked = false,
                formatters = formatters,
                workspaceFormatter = MoneyFormatter("EUR"),
                syncingConnectionIds = emptySet(),
                disconnectingConnectionIds = emptySet(),
                pendingAccountToggles = emptySet(),
                actions = AccountsActions(),
                modifier = Modifier.padding(BallastSpacing.md),
                now = AccountsPreviewData.now,
                today = AccountsPreviewData.today,
            )
        }
    }
}

/** How to connect a bank that is set up but has no connections yet. */
@Preview(name = "Provider how to connect", showBackground = true, heightDp = 520)
@Composable
private fun ProviderHowToConnectPreview() {
    BallastTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            val formatters = remember {
                MoneyFormatterCache(MoneyFormatter("EUR"), "EUR")
            }
            ProviderDetailBody(
                provider = AccountsPreviewData.gocardless,
                connections = emptyList(),
                locked = false,
                formatters = formatters,
                workspaceFormatter = MoneyFormatter("EUR"),
                syncingConnectionIds = emptySet(),
                disconnectingConnectionIds = emptySet(),
                pendingAccountToggles = emptySet(),
                actions = AccountsActions(),
                modifier = Modifier.padding(BallastSpacing.md),
                now = AccountsPreviewData.now,
                today = AccountsPreviewData.today,
            )
        }
    }
}

@Composable
private fun PreviewScreen(state: AccountsUiState) {
    BallastTheme {
        // The theme sets colours but paints nothing, so the preview needs a
        // surface of its own or the cards float on the tool's white page.
        Surface(color = MaterialTheme.colorScheme.background) {
            AccountsContent(
                state = state,
                actions = AccountsActions(),
                contentPadding = PaddingValues(0.dp),
                now = AccountsPreviewData.now,
                today = AccountsPreviewData.today,
            )
        }
    }
}
