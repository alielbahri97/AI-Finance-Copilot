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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
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
import com.ballastmoney.android.ui.BallastTestTags
import com.ballastmoney.android.ui.bank.BankConnectActions
import com.ballastmoney.android.ui.bank.BankConnectCard
import com.ballastmoney.android.ui.bank.BankConnectUiState
import com.ballastmoney.android.ui.bank.BankConnectViewModel
import com.ballastmoney.android.ui.bank.BankPickerSheet
import com.ballastmoney.android.ui.bank.BankProviders
import com.ballastmoney.android.ui.bank.dismissBankConsent
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
 *
 * The GoCardless connect affordance is intercepted here rather than handed to
 * [onConnectProvider]: connecting a bank needs a bank chosen first, and that
 * happens in a sheet over this screen because navigation is another package's.
 * Every other provider goes on to [onConnectProvider] untouched.
 */
@Composable
fun AccountsScreen(
    onNavigateToBilling: () -> Unit,
    onConnectProvider: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: AccountsViewModel = hiltViewModel(),
    bankViewModel: BankConnectViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val bankState by bankViewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    var pickingBank by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(viewModel, snackbarHostState) {
        viewModel.messages.collect { message ->
            snackbarHostState.showSnackbar(message.display)
        }
    }

    // Every return to the foreground is a chance that the bank approval has
    // landed. The record on disk is what decides whether there is anything to
    // ask about, so this is correct even after the process was killed behind
    // the browser and the screen has only just been rebuilt.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        bankViewModel.onResumed()
    }

    LaunchedEffect(bankViewModel, context) {
        bankViewModel.tabDismissals.collect { dismissBankConsent(context) }
    }

    LaunchedEffect(bankViewModel, viewModel) {
        // A finalized connection exists only in `GET /api/integrations` as far as
        // this screen is concerned, so the overview has to be re-read before the
        // new bank can appear in the list.
        bankViewModel.connections.collect { viewModel.refresh() }
    }

    val onConnect: (String) -> Unit = remember(onConnectProvider) {
        { providerId ->
            if (providerId == BankProviders.GOCARDLESS) {
                pickingBank = true
            } else {
                onConnectProvider(providerId)
            }
        }
    }

    val actions = remember(viewModel, onNavigateToBilling, onConnect) {
        AccountsActions(
            onRefresh = viewModel::refresh,
            onNavigateToBilling = onNavigateToBilling,
            onConnectProvider = onConnect,
            onSync = viewModel::sync,
            onDisconnect = viewModel::disconnect,
            onToggleAccount = viewModel::setIncludeInTotals,
            onOpenProvider = viewModel::openProvider,
            onDismissProvider = viewModel::dismissProvider,
        )
    }

    val bankActions = remember(bankViewModel) {
        BankConnectActions(
            onCheckNow = bankViewModel::checkNow,
            onStopWaiting = bankViewModel::stopWaiting,
            onDismissNotice = bankViewModel::dismissNotice,
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        AccountsContent(
            state = state,
            actions = actions,
            contentPadding = contentPadding,
            modifier = Modifier.fillMaxSize(),
            bankConnect = bankState,
            bankActions = bankActions,
        )
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(contentPadding),
        )
    }

    if (pickingBank) {
        BankPickerSheet(
            onDismiss = { pickingBank = false },
            onTabOpened = bankViewModel::onConsentTabOpened,
        )
    }
}

/**
 * The whole screen as a function of its state. [now] and [today] are parameters
 * so consent countdowns and rate-limit windows are deterministic in previews
 * and tests rather than depending on when the screenshot was taken.
 *
 * [bankConnect] defaults to nothing outstanding, which is what every preview and
 * every state other than [AccountsUiState.Ready] shows.
 */
@Composable
fun AccountsContent(
    state: AccountsUiState,
    actions: AccountsActions,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    today: LocalDate = LocalDate.now(),
    bankConnect: BankConnectUiState = BankConnectUiState(),
    bankActions: BankConnectActions = BankConnectActions(),
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
            bankConnect = bankConnect,
            bankActions = bankActions,
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
    bankConnect: BankConnectUiState = BankConnectUiState(),
    bankActions: BankConnectActions = BankConnectActions(),
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
                .widthIn(max = ReadableWidth)
                .testTag(BallastTestTags.ACCOUNTS_LIST),
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

            // Above the plan and limit banners: an attempt the user made thirty
            // seconds ago is more urgent than a standing condition of the
            // workspace, and it is the thing they came back to the app to see.
            if (bankConnect.visible) {
                item(key = "bank-connect") {
                    BankConnectCard(
                        state = bankConnect,
                        onCheckNow = bankActions.onCheckNow,
                        onStopWaiting = bankActions.onStopWaiting,
                        onDismissNotice = bankActions.onDismissNotice,
                    )
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
