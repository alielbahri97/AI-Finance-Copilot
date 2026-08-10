package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastCardHeader
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.SectionHeading
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.time.Instant
import java.time.LocalDate

/**
 * The blocks the accounts screen is made of: the page header, the aggregate
 * card, the grouped provider tiles and the provider detail sheet. All
 * stateless — every one of them takes what it renders and reports what was
 * pressed.
 */

@Composable
fun AccountsHeader(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(text = "Banks & accounts", style = BallastTextStyles.pageTitle)
        Spacer(Modifier.height(BallastSpacing.xxs))
        Text(
            text = "Connect a bank or tool. Synced sources refresh every few hours.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }
}

/**
 * What the connected accounts add up to.
 *
 * Currencies are listed separately rather than added together: there is no
 * exchange rate on the client, and a total that silently treats $1 as €1 is
 * worse than no total at all.
 */
@Composable
fun CountedBalanceCard(
    totals: AccountsTotals,
    formatters: MoneyFormatterCache,
    modifier: Modifier = Modifier,
) {
    BallastCard(modifier = modifier.fillMaxWidth()) {
        BallastCardHeader(
            title = "Counted balance",
            description = "What Ballast adds up as your cash on the dashboard.",
        )
        Spacer(Modifier.height(BallastSpacing.xs))
        val primary = totals.totals.firstOrNull()
        if (primary == null) {
            Text(
                text = "No balances yet",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        } else {
            MoneyText(
                amount = primary.amount,
                formatter = formatters.forCurrency(primary.currency),
                size = MoneySize.HERO,
            )
            totals.totals.drop(1).forEach { total ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = BallastSpacing.xxs),
                ) {
                    MoneyText(
                        amount = total.amount,
                        formatter = formatters.forCurrency(total.currency),
                        size = MoneySize.SM,
                    )
                    Spacer(Modifier.width(BallastSpacing.xs))
                    Text(
                        text = "${total.currency} · ${pluralAccounts(total.accounts)}",
                        style = BallastTextStyles.micro,
                        color = MaterialTheme.ballastColors.mutedForeground,
                    )
                }
            }
        }
        Spacer(Modifier.height(BallastSpacing.xs))
        InfoLine(countedSummaryText(totals))
    }
}

/** A collapsible group of provider tiles: "Banks", "Accounting" and so on. */
@Composable
fun ProviderGroupSectionView(
    section: ProviderGroupSection,
    connectionsFor: (String) -> List<IntegrationConnection>,
    locked: Boolean,
    columns: Int,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    onOpenProvider: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggleExpanded)
                .padding(vertical = BallastSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                // `sectionLabel` is letter-spaced for capitals and leaves the
                // casing to the caller, as the web's `uppercase` class does.
                text = section.group.label.uppercase(),
                style = BallastTextStyles.sectionLabel,
                color = MaterialTheme.ballastColors.mutedForeground,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = if (expanded) {
                    Icons.Filled.KeyboardArrowUp
                } else {
                    Icons.Filled.KeyboardArrowDown
                },
                contentDescription = if (expanded) {
                    "Collapse ${section.group.label}"
                } else {
                    "Expand ${section.group.label}"
                },
                tint = MaterialTheme.ballastColors.mutedForeground,
            )
        }
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                // Laid out by hand rather than with a lazy grid: this sits
                // inside the screen's LazyColumn, which cannot nest another
                // scrolling container, and a group never holds more than a
                // handful of tiles.
                section.providers.chunked(columns).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                        row.forEach { provider ->
                            ProviderTile(
                                provider = provider,
                                status = providerTileStatus(
                                    provider = provider,
                                    connections = connectionsFor(provider.id),
                                    locked = locked,
                                ),
                                onClick = { onOpenProvider(provider.id) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                        repeat(columns - row.size) {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProviderTile(
    provider: IntegrationProvider,
    status: ProviderTileStatus,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Tighter than the default card padding: two tiles across a phone leave
    // about 130dp of text, and 16dp of inset on each side eats a word of it.
    BallastCard(
        modifier = modifier,
        onClick = onClick,
        contentPadding = PaddingValues(BallastSpacing.md),
    ) {
        Icon(
            imageVector = providerIcon(provider),
            contentDescription = null,
            tint = MaterialTheme.ballastColors.accentForeground,
            modifier = Modifier.size(TileIconSize),
        )
        Spacer(Modifier.height(BallastSpacing.xs))
        Text(
            text = provider.displayName,
            style = MaterialTheme.typography.titleSmall,
            // Fixed at two lines so tiles in a row share a baseline whether the
            // name is "Tink" or "GoCardless Bank Account Data".
            maxLines = 2,
            minLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        val description = providerDescription(provider.id)
        if (description != null) {
            Text(
                text = description,
                style = BallastTextStyles.micro,
                color = MaterialTheme.ballastColors.mutedForeground,
                maxLines = 2,
                minLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = BallastSpacing.xxs),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(top = BallastSpacing.xs),
        ) {
            StatusDot(status.tone)
            Spacer(Modifier.width(BallastSpacing.xs))
            Text(
                text = status.label,
                style = BallastTextStyles.micro,
                color = MaterialTheme.ballastColors.mutedForeground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The provider sheet: what the provider is, and then either how to connect it
 * or what is already connected.
 */
@Composable
fun ProviderDetailSheet(
    provider: IntegrationProvider,
    connections: List<IntegrationConnection>,
    locked: Boolean,
    formatters: MoneyFormatterCache,
    workspaceFormatter: MoneyFormatter,
    syncingConnectionIds: Set<String>,
    disconnectingConnectionIds: Set<String>,
    pendingAccountToggles: Set<String>,
    actions: AccountsActions,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
) {
    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = provider.displayName,
        description = providerDescription(provider.id),
        modifier = modifier,
    ) {
        ProviderDetailBody(
            provider = provider,
            connections = connections,
            locked = locked,
            formatters = formatters,
            workspaceFormatter = workspaceFormatter,
            syncingConnectionIds = syncingConnectionIds,
            disconnectingConnectionIds = disconnectingConnectionIds,
            pendingAccountToggles = pendingAccountToggles,
            actions = actions,
            modifier = Modifier.verticalScroll(rememberScrollState()),
            now = now,
            today = today,
        )
    }
}

/**
 * The sheet's contents, without the sheet.
 *
 * Split out because a modal sheet does not render in `@Preview` — it is a
 * separate window — and these are the states most worth looking at.
 */
@Composable
fun ProviderDetailBody(
    provider: IntegrationProvider,
    connections: List<IntegrationConnection>,
    locked: Boolean,
    formatters: MoneyFormatterCache,
    workspaceFormatter: MoneyFormatter,
    syncingConnectionIds: Set<String>,
    disconnectingConnectionIds: Set<String>,
    pendingAccountToggles: Set<String>,
    actions: AccountsActions,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        CapabilityBadges(provider.capabilities)
        BallastSeparator()

        when {
            locked -> UpgradeBlock(onNavigateToBilling = actions.onNavigateToBilling)

            !provider.configured -> NotConfiguredBlock()

            connections.isEmpty() -> Column {
                BlockHeading("How to connect")
                NumberedSteps(providerConnectSteps(provider.id))
                Spacer(Modifier.height(BallastSpacing.sm))
                BallastButton(
                    text = connectButtonLabel(provider),
                    onClick = { actions.onConnectProvider(provider.id) },
                    variant = ButtonVariant.PRIMARY,
                    fillMaxWidth = true,
                )
            }

            else -> Column(
                verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
            ) {
                BlockHeading(
                    if (connections.size > 1) {
                        "Connections (${connections.size})"
                    } else {
                        "Connection"
                    },
                )
                connections.forEach { connection ->
                    ConnectionCard(
                        connection = connection,
                        formatters = formatters,
                        workspaceFormatter = workspaceFormatter,
                        syncing = connection.id in syncingConnectionIds,
                        disconnecting = connection.id in disconnectingConnectionIds,
                        pendingAccountToggles = pendingAccountToggles,
                        onSync = { actions.onSync(connection.id) },
                        onReconnect = { actions.onConnectProvider(provider.id) },
                        onDisconnect = { actions.onDisconnect(connection.id) },
                        onToggleAccount = { accountId, include ->
                            actions.onToggleAccount(connection.id, accountId, include)
                        },
                        now = now,
                        today = today,
                    )
                }
                if (provider.multiInstance) {
                    BallastButton(
                        text = "Connect another",
                        onClick = { actions.onConnectProvider(provider.id) },
                        variant = ButtonVariant.OUTLINE,
                        fillMaxWidth = true,
                    )
                }
            }
        }
    }
}

/** The plan gate, both in the sheet and inline on the screen. */
@Composable
fun UpgradeBlock(
    onNavigateToBilling: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        SectionHeading(
            title = "Integrations are a Business feature",
            description = "Upgrade to connect banks, accounting software and messaging tools.",
        )
        Spacer(Modifier.height(BallastSpacing.sm))
        BallastButton(
            text = "Upgrade plan",
            onClick = onNavigateToBilling,
            variant = ButtonVariant.PRIMARY,
            size = ButtonSize.SMALL,
        )
    }
}

/** The server is missing this provider's credentials. Nothing the user can fix. */
@Composable
fun NotConfiguredBlock(modifier: Modifier = Modifier) {
    SectionHeading(
        title = "Not available yet",
        description = "This integration hasn't been set up on this server. Ask your " +
            "administrator to configure it.",
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun NoBanksEmptyState(
    onConnectBank: () -> Unit,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        icon = Icons.Outlined.AccountBalance,
        title = "No banks connected",
        description = "Connect a bank and Ballast keeps balances and transactions up to " +
            "date on its own. Access is read-only.",
        modifier = modifier,
        primaryAction = {
            BallastButton(
                text = "Connect a bank",
                onClick = onConnectBank,
                size = ButtonSize.SMALL,
            )
        },
    )
}

private val TileIconSize = 24.dp
