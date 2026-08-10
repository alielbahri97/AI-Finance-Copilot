package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.ConnectedAccount
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastAlertDialog
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.BallastSwitch
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.time.Instant
import java.time.LocalDate

/**
 * One connection: its health, its accounts and the three things you can do to
 * it.
 *
 * Stateless apart from whether the disconnect confirmation is showing, which is
 * UI state in the strictest sense — it means nothing outside this card and
 * survives rotation on its own.
 */
@Composable
fun ConnectionCard(
    connection: IntegrationConnection,
    formatters: MoneyFormatterCache,
    workspaceFormatter: MoneyFormatter,
    syncing: Boolean,
    disconnecting: Boolean,
    pendingAccountToggles: Set<String>,
    onSync: () -> Unit,
    onReconnect: () -> Unit,
    onDisconnect: () -> Unit,
    onToggleAccount: (accountId: String, includeInTotals: Boolean) -> Unit,
    modifier: Modifier = Modifier,
    /** Shown above the title when the card is not already under its provider. */
    providerName: String? = null,
    enabled: Boolean = true,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
) {
    var confirmingDisconnect by rememberSaveable(connection.id) { mutableStateOf(false) }
    val badge = connectionStatusBadge(connection.status)
    val summary = connectionSummaryText(connection) { formatters.forCurrency(it) }
    val syncLine = lastSyncText(connection, workspaceFormatter)
    val consent = consentState(connection, today)
    val rateLimit = rateLimitText(connection, workspaceFormatter, now)
    val error = connectionErrorText(connection)

    BallastCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
            if (providerName != null) {
                Text(
                    // Not the uppercase eyebrow: "GOCARDLESS BANK ACCOUNT DATA"
                    // shouts over the bank name it is meant to qualify.
                    text = providerName,
                    style = BallastTextStyles.micro,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            ) {
                Text(
                    text = connection.title,
                    style = BallastTextStyles.cardTitle,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                BallastBadge(text = badge.label, variant = badgeVariantFor(badge.tone))
            }

            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.xxs)) {
                if (summary != null) InfoLine(summary)
                if (syncLine != null) InfoLine(syncLine)
                if (consent is ConsentState.ValidUntil) {
                    InfoLine(consentValidUntilText(consent.date, workspaceFormatter))
                }
                if (rateLimit != null) InfoLine(rateLimit)
            }

            if (consent is ConsentState.Expiring) {
                BallastAlert(
                    title = consentWarningText(consent.daysLeft),
                    variant = AlertVariant.WARNING,
                    icon = Icons.Filled.Warning,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (error != null) {
                BallastAlert(
                    title = error,
                    variant = AlertVariant.DESTRUCTIVE,
                    icon = Icons.Filled.Warning,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (connection.accounts.isNotEmpty()) {
                ConnectedAccountsSection(
                    accounts = connection.accounts,
                    formatters = formatters,
                    pendingAccountToggles = pendingAccountToggles,
                    enabled = enabled,
                    onToggleAccount = onToggleAccount,
                )
            }

            ConnectionActions(
                connection = connection,
                syncing = syncing,
                disconnecting = disconnecting,
                enabled = enabled,
                onSync = onSync,
                onReconnect = onReconnect,
                onRequestDisconnect = { confirmingDisconnect = true },
            )
        }
    }

    if (confirmingDisconnect) {
        BallastAlertDialog(
            onDismissRequest = { confirmingDisconnect = false },
            title = "Disconnect ${connection.title}?",
            description = "Syncing stops for this connection only. Transactions already " +
                "imported stay, but its accounts stop counting towards your cash total.",
            confirmText = "Disconnect",
            dismissText = "Keep it",
            destructive = true,
            // The dialog stays open and blocks its own buttons while the call
            // runs, so a failure lands on the dialog rather than on a screen
            // the user has already moved on from.
            loading = disconnecting,
            onConfirm = onDisconnect,
        )
    }
}

@Composable
private fun ConnectionActions(
    connection: IntegrationConnection,
    syncing: Boolean,
    disconnecting: Boolean,
    enabled: Boolean,
    onSync: () -> Unit,
    onReconnect: () -> Unit,
    onRequestDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (connection.status == ConnectionStatus.EXPIRED) {
            BallastButton(
                text = "Reconnect",
                onClick = onReconnect,
                variant = ButtonVariant.PRIMARY,
                size = ButtonSize.SMALL,
                enabled = enabled,
                modifier = Modifier.weight(1f),
            )
        }
        if (canSyncNow(connection)) {
            BallastButton(
                text = if (syncing) "Syncing…" else "Sync now",
                onClick = onSync,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
                enabled = enabled && !syncing,
                loading = syncing,
                modifier = Modifier.weight(1f),
            )
        }
        BallastButton(
            text = "Disconnect",
            onClick = onRequestDisconnect,
            variant = ButtonVariant.GHOST,
            size = ButtonSize.SMALL,
            enabled = enabled && !disconnecting,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ConnectedAccountsSection(
    accounts: List<ConnectedAccount>,
    formatters: MoneyFormatterCache,
    pendingAccountToggles: Set<String>,
    enabled: Boolean,
    onToggleAccount: (accountId: String, includeInTotals: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        BlockHeading("Accounts")
        accounts.forEachIndexed { index, account ->
            if (index > 0) {
                BallastSeparator(modifier = Modifier.padding(vertical = BallastSpacing.xs))
            }
            ConnectedAccountRow(
                account = account,
                formatter = formatters.forCurrency(account.currency),
                pending = account.id in pendingAccountToggles,
                enabled = enabled,
                onToggle = { include -> onToggleAccount(account.id, include) },
            )
        }
        Text(
            text = "An excluded account still shows here, but it is left out of the cash " +
                "total on your dashboard.",
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
            modifier = Modifier.padding(top = BallastSpacing.xs),
        )
    }
}

@Composable
private fun ConnectedAccountRow(
    account: ConnectedAccount,
    formatter: MoneyFormatter,
    pending: Boolean,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = accountLabel(account).uppercase(),
                style = BallastTextStyles.tableHeader,
                color = MaterialTheme.ballastColors.mutedForeground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val balance = account.balance
            if (balance != null) {
                MoneyText(
                    amount = balance,
                    formatter = formatter,
                    size = MoneySize.MD,
                )
            } else {
                Text(
                    text = "No balance yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
        }
        Spacer(Modifier.width(BallastSpacing.sm))
        Text(
            text = "In totals",
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        Spacer(Modifier.width(BallastSpacing.xs))
        BallastSwitch(
            checked = account.includeInTotals,
            onCheckedChange = onToggle,
            // "In totals" beside it is enough to read but not to hear: a card with
            // three of these announces three identical switches otherwise.
            modifier = Modifier.semantics {
                contentDescription = "Count ${accountLabel(account)} in totals"
            },
            enabled = enabled && !pending,
        )
    }
}
