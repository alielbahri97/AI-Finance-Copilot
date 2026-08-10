package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.core.model.ProviderCategory
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.ErrorState
import com.ballastmoney.android.designsystem.component.ListRowSkeleton
import com.ballastmoney.android.designsystem.component.SectionHeading
import com.ballastmoney.android.designsystem.component.Skeleton
import com.ballastmoney.android.designsystem.component.SkeletonText
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import java.time.Instant
import java.time.LocalDate

/**
 * Banks & accounts — the mobile port of `/integrations`.
 *
 * The screen reads one [AccountsUiState] and reports intents; nothing below
 * this function knows the ViewModel exists, which is what lets every state in
 * the file have a preview.
 *
 * [contentPadding] carries the window insets down from the shell. The screen
 * scrolls edge to edge and applies them to the list's content rather than to
 * the list itself, so a bank card can pass under the navigation bar instead of
 * stopping short of it.
 */
@Composable
fun AccountsScreen(
    onNavigateToBilling: () -> Unit,
    onConnectProvider: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: AccountsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(viewModel, snackbarHostState) {
        viewModel.messages.collect { message ->
            snackbarHostState.showSnackbar(message.display)
        }
    }

    val actions = remember(viewModel, onNavigateToBilling, onConnectProvider) {
        AccountsActions(
            onRefresh = viewModel::refresh,
            onNavigateToBilling = onNavigateToBilling,
            onConnectProvider = onConnectProvider,
            onSync = viewModel::sync,
            onDisconnect = viewModel::disconnect,
            onToggleAccount = viewModel::setIncludeInTotals,
            onOpenProvider = viewModel::openProvider,
            onDismissProvider = viewModel::dismissProvider,
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        AccountsContent(
            state = state,
            actions = actions,
            contentPadding = contentPadding,
            modifier = Modifier.fillMaxSize(),
        )
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(contentPadding),
        )
    }
}

/**
 * The whole screen as a function of its state. [now] and [today] are parameters
 * so consent countdowns and rate-limit windows are deterministic in previews
 * and tests rather than depending on when the screenshot was taken.
 */
@Composable
fun AccountsContent(
    state: AccountsUiState,
    actions: AccountsActions,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
) {
    when (state) {
        AccountsUiState.Loading -> AccountsLoading(
            contentPadding = contentPadding,
            modifier = modifier,
        )

        is AccountsUiState.Error -> AccountsError(
            state = state,
            onRetry = actions.onRefresh,
            contentPadding = contentPadding,
            modifier = modifier,
        )

        is AccountsUiState.Ready -> AccountsReady(
            state = state,
            actions = actions,
            contentPadding = contentPadding,
            modifier = modifier,
            now = now,
            today = today,
        )
    }
}

@Composable
private fun AccountsLoading(
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = BallastSpacing.md, vertical = BallastSpacing.md),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        SkeletonText(lines = 2, lastLineFraction = 0.7f)
        Skeleton(modifier = Modifier.fillMaxWidth().height(AggregateSkeletonHeight))
        Skeleton(modifier = Modifier.fillMaxWidth().height(TileRowSkeletonHeight))
        ListRowSkeleton(rows = 3)
    }
}

@Composable
private fun AccountsError(
    state: AccountsUiState.Error,
    onRetry: () -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val title = if (state.retryable) {
        "Couldn't load banks and accounts"
    } else {
        "You do not have access"
    }
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(BallastSpacing.lg),
        contentAlignment = Alignment.Center,
    ) {
        ErrorState(
            title = title,
            description = state.message,
            // No retry on the permission wall: pressing it cannot grant
            // `manage_integrations`, and a button that does nothing is worse
            // than no button.
            onRetry = if (state.retryable) onRetry else null,
        )
    }
}

@Composable
private fun AccountsReady(
    state: AccountsUiState.Ready,
    actions: AccountsActions,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
) {
    val layoutDirection = LocalLayoutDirection.current
    val formatters = remember(state.formatter, state.currency) {
        MoneyFormatterCache(state.formatter, state.currency)
    }
    val connections = state.overview.connections
    val providers = state.visibleProviders
    val providersById = remember(providers) { providers.associateBy { it.id } }
    val connectedProviderIds = remember(connections) { connections.map { it.providerId }.toSet() }
    val sections = remember(providers, connectedProviderIds) {
        groupProviders(providers, connectedProviderIds)
    }
    val totals = remember(connections, state.currency) {
        computeTotals(connections, state.currency)
    }
    val orderedConnections = remember(connections, providersById) {
        // Banks first: this release is about bank balances, and a Slack
        // connection is not what anyone scrolled here for.
        connections.sortedBy { connection ->
            providersById[connection.providerId]?.category?.ordinal ?: Int.MAX_VALUE
        }
    }
    val hasBankConnection = orderedConnections.any {
        providersById[it.providerId]?.category == ProviderCategory.BANKING
    }
    val firstBankProviderId = providers
        .firstOrNull { it.category == ProviderCategory.BANKING }
        ?.id

    var expandedGroups by rememberSaveable { mutableStateOf(DefaultExpandedGroups) }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val columns = when {
            maxWidth >= ExpandedWidth -> 4
            maxWidth >= MediumWidth -> 3
            else -> 2
        }
        val listPadding = PaddingValues(
            start = contentPadding.calculateStartPadding(layoutDirection) + BallastSpacing.md,
            end = contentPadding.calculateEndPadding(layoutDirection) + BallastSpacing.md,
            top = contentPadding.calculateTopPadding() + BallastSpacing.md,
            bottom = contentPadding.calculateBottomPadding() + BallastSpacing.xxl,
        )

        LazyColumn(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxHeight()
                .widthIn(max = ReadableWidth),
            contentPadding = listPadding,
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
        ) {
            item(key = "header") {
                Column {
                    AccountsHeader()
                    if (state.isRefreshing) {
                        InfoLine(
                            text = "Refreshing…",
                            modifier = Modifier.padding(top = BallastSpacing.xs),
                        )
                    }
                }
            }

            if (state.locked) {
                item(key = "locked") {
                    BallastCard(modifier = Modifier.fillMaxWidth()) {
                        UpgradeBlock(onNavigateToBilling = actions.onNavigateToBilling)
                    }
                }
            }

            if (state.limitReached) {
                item(key = "limit-reached") {
                    ConnectionLimitBanner(
                        bankConnections = state.limits.bankConnections,
                        onNavigateToBilling = actions.onNavigateToBilling,
                    )
                }
            }

            if (totals.hasAccounts) {
                item(key = "totals") {
                    CountedBalanceCard(totals = totals, formatters = formatters)
                }
            }

            items(items = sections, key = { it.group.name }) { section ->
                ProviderGroupSectionView(
                    section = section,
                    connectionsFor = { providerId ->
                        connections.filter { it.providerId == providerId }
                    },
                    locked = state.locked,
                    columns = columns,
                    expanded = section.group.name in expandedGroups,
                    onToggleExpanded = {
                        expandedGroups = if (section.group.name in expandedGroups) {
                            expandedGroups - section.group.name
                        } else {
                            expandedGroups + section.group.name
                        }
                    },
                    onOpenProvider = actions.onOpenProvider,
                )
            }

            if (!state.locked && !hasBankConnection) {
                item(key = "no-banks") {
                    NoBanksEmptyState(
                        onConnectBank = {
                            firstBankProviderId?.let(actions.onOpenProvider)
                        },
                    )
                }
            }

            if (orderedConnections.isNotEmpty()) {
                item(key = "connections-heading") {
                    SectionHeading(
                        title = "Your connections",
                        description = pluralConnections(orderedConnections.size),
                    )
                }
                items(items = orderedConnections, key = { it.id }) { connection ->
                    ConnectionCard(
                        connection = connection,
                        formatters = formatters,
                        workspaceFormatter = state.formatter,
                        syncing = connection.id in state.syncingConnectionIds,
                        disconnecting = connection.id in state.disconnectingConnectionIds,
                        pendingAccountToggles = state.pendingAccountToggles,
                        onSync = { actions.onSync(connection.id) },
                        onReconnect = { actions.onConnectProvider(connection.providerId) },
                        onDisconnect = { actions.onDisconnect(connection.id) },
                        onToggleAccount = { accountId, include ->
                            actions.onToggleAccount(connection.id, accountId, include)
                        },
                        providerName = providerNameFor(connection, providersById),
                        enabled = state.canManage,
                        now = now,
                        today = today,
                    )
                }
            }
        }
    }

    val selected = state.selectedProviderId?.let { providersById[it] }
    if (selected != null) {
        ProviderDetailSheet(
            provider = selected,
            connections = connections.filter { it.providerId == selected.id },
            locked = state.locked,
            formatters = formatters,
            workspaceFormatter = state.formatter,
            syncingConnectionIds = state.syncingConnectionIds,
            disconnectingConnectionIds = state.disconnectingConnectionIds,
            pendingAccountToggles = state.pendingAccountToggles,
            actions = actions,
            onDismiss = actions.onDismissProvider,
            now = now,
            today = today,
        )
    }
}

/**
 * The plan allows integrations but not another bank. Distinct from the upgrade
 * wall: everything already connected keeps working.
 */
@Composable
private fun ConnectionLimitBanner(
    bankConnections: Int?,
    onNavigateToBilling: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val allowance = bankConnections
        ?.let { "Your plan includes ${pluralConnections(it)}." }
        .orEmpty()
    BallastAlert(
        title = "Connection limit reached",
        description = "$allowance Disconnect one you no longer use, or upgrade to add more."
            .trim(),
        variant = AlertVariant.WARNING,
        icon = Icons.Filled.Warning,
        modifier = modifier.fillMaxWidth(),
        action = {
            BallastButton(
                text = "Upgrade plan",
                onClick = onNavigateToBilling,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
            )
        },
    )
}

private fun providerNameFor(
    connection: IntegrationConnection,
    providersById: Map<String, IntegrationProvider>,
): String? {
    val provider = providersById[connection.providerId] ?: return null
    // A GoCardless connection titled "ING" needs the provider named above it; a
    // Slack connection titled "Slack" does not.
    return provider.displayName.takeIf { it != connection.title }
}

private val MediumWidth = 600.dp
private val ExpandedWidth = 840.dp

/**
 * Text stops being readable long before a tablet is wide, so the column caps
 * out and centres instead of stretching to the window.
 */
private val ReadableWidth = 900.dp

private val AggregateSkeletonHeight = 120.dp
private val TileRowSkeletonHeight = 140.dp
