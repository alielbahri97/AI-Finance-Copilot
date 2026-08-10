package com.ballastmoney.android.ui.accounts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.domain.IntegrationsRepository
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.SessionBootstrap
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject

/**
 * Banks and accounts.
 *
 * The session decides which workspace is in play, the workspace decides which
 * integrations overview to read, and the two are combined with a small bag of
 * purely local state — what is syncing, what is being toggled — into one
 * [AccountsUiState]. Reads never throw, so the only failure paths are the
 * explicit refreshes and writes, each of which reports through [messages]
 * rather than through the state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AccountsViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val integrationsRepository: IntegrationsRepository,
) : ViewModel() {

    private val local = MutableStateFlow(LocalState())

    private val _messages = Channel<AccountsMessage>(Channel.BUFFERED)

    /** Toasts and snackbars: consumed once, never replayed on rotation. */
    val messages: Flow<AccountsMessage> = _messages.receiveAsFlow()

    /**
     * Formatters are cached because each one builds a [java.text.NumberFormat],
     * and the combine below runs on every emission from either source.
     */
    private val formatters = ConcurrentHashMap<String, MoneyFormatter>()

    /** Last known workspace, so an intent fired from the UI knows where to write. */
    @Volatile
    private var workspaceId: String? = null

    private val overview: Flow<IntegrationsOverview?> = sessionRepository.session
        .map { it?.currentWorkspace?.id }
        .distinctUntilChanged()
        .flatMapLatest { id ->
            if (id == null) flowOf(null) else integrationsRepository.overview(id)
        }
        .onEach { settleOptimisticToggles(it) }

    val uiState: StateFlow<AccountsUiState> = combine(
        sessionRepository.session,
        overview,
        local,
    ) { session, overviewValue, localState ->
        toUiState(session, overviewValue, localState)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = AccountsUiState.Loading,
    )

    init {
        // One refresh per workspace the user lands on. The cached overview
        // paints first and is replaced in place when the network answers, so
        // this is never the difference between a screen and a spinner.
        viewModelScope.launch {
            sessionRepository.session
                .map { session ->
                    session?.takeIf { Permission.MANAGE_INTEGRATIONS in it.permissions }
                        ?.currentWorkspace
                        ?.id
                }
                .distinctUntilChanged()
                .collect { id ->
                    workspaceId = id
                    if (id != null) refreshWorkspace(id, announceFailure = false)
                }
        }
    }

    fun refresh() {
        val id = workspaceId ?: return
        viewModelScope.launch { refreshWorkspace(id, announceFailure = true) }
    }

    fun sync(connectionId: String) {
        val id = workspaceId ?: return
        if (connectionId in local.value.syncingConnectionIds) return
        local.update { it.copy(syncingConnectionIds = it.syncingConnectionIds + connectionId) }
        viewModelScope.launch {
            integrationsRepository.sync(id, connectionId)
                .onSuccess { outcome ->
                    val stats = outcome.stats.entries
                        .joinToString(", ") { (key, value) -> "$key: $value" }
                        .takeIf { it.isNotEmpty() }
                    _messages.send(
                        AccountsMessage("${outcome.connectionTitle} synced", detail = stats),
                    )
                }
                .onFailure { error ->
                    _messages.send(
                        AccountsMessage(error.messageOr("Sync failed"), isError = true),
                    )
                }
            local.update { it.copy(syncingConnectionIds = it.syncingConnectionIds - connectionId) }
        }
    }

    /**
     * Optimistic on purpose.
     *
     * This is the switch people flip most on this screen, often several times
     * in a row while deciding what counts as their cash. Waiting for a round
     * trip before the switch moves reads as a broken control, so the override
     * is applied immediately, held while the write is in flight, and dropped
     * again — reverting the switch — if the server refuses.
     */
    fun setIncludeInTotals(connectionId: String, accountId: String, includeInTotals: Boolean) {
        val id = workspaceId ?: return
        if (accountId in local.value.pendingAccountToggles) return
        local.update {
            it.copy(
                pendingAccountToggles = it.pendingAccountToggles + accountId,
                toggleOverrides = it.toggleOverrides + (accountId to includeInTotals),
            )
        }
        viewModelScope.launch {
            integrationsRepository
                .setIncludeInTotals(id, connectionId, accountId, includeInTotals)
                .onSuccess {
                    local.update {
                        it.copy(pendingAccountToggles = it.pendingAccountToggles - accountId)
                    }
                    _messages.send(AccountsMessage(accountToggleMessage(includeInTotals)))
                }
                .onFailure { error ->
                    local.update {
                        it.copy(
                            pendingAccountToggles = it.pendingAccountToggles - accountId,
                            toggleOverrides = it.toggleOverrides - accountId,
                        )
                    }
                    _messages.send(
                        AccountsMessage(
                            error.messageOr("Could not update the account"),
                            isError = true,
                        ),
                    )
                }
        }
    }

    fun disconnect(connectionId: String) {
        val id = workspaceId ?: return
        if (connectionId in local.value.disconnectingConnectionIds) return
        val title = titleOf(connectionId)
        local.update {
            it.copy(disconnectingConnectionIds = it.disconnectingConnectionIds + connectionId)
        }
        viewModelScope.launch {
            integrationsRepository.disconnect(id, connectionId)
                .onSuccess { _messages.send(AccountsMessage("$title disconnected")) }
                .onFailure { error ->
                    _messages.send(
                        AccountsMessage(error.messageOr("Could not disconnect"), isError = true),
                    )
                }
            local.update {
                it.copy(disconnectingConnectionIds = it.disconnectingConnectionIds - connectionId)
            }
        }
    }

    fun openProvider(providerId: String) {
        local.update { it.copy(selectedProviderId = providerId) }
    }

    fun dismissProvider() {
        local.update { it.copy(selectedProviderId = null) }
    }

    private suspend fun refreshWorkspace(id: String, announceFailure: Boolean) {
        if (local.value.isRefreshing) return
        local.update { it.copy(isRefreshing = true) }
        integrationsRepository.refresh(id)
            .onSuccess { local.update { it.copy(isRefreshing = false, loadError = null) } }
            .onFailure { error ->
                val message = error.messageOr("Could not refresh banks and accounts")
                local.update { it.copy(isRefreshing = false, loadError = message) }
                // Only worth a snackbar when there is already a screen to
                // interrupt; with nothing cached the error state says it.
                if (announceFailure && uiState.value is AccountsUiState.Ready) {
                    _messages.send(AccountsMessage(message, isError = true))
                }
            }
    }

    private fun toUiState(
        session: SessionBootstrap?,
        overview: IntegrationsOverview?,
        localState: LocalState,
    ): AccountsUiState {
        if (session == null) return AccountsUiState.Loading
        if (Permission.MANAGE_INTEGRATIONS !in session.permissions) {
            return AccountsUiState.Error(
                message = "You do not have access to banks and accounts in this workspace. " +
                    "Ask an owner or admin for the Manage integrations permission.",
                retryable = false,
            )
        }
        if (overview == null) {
            val error = localState.loadError ?: return AccountsUiState.Loading
            return AccountsUiState.Error(error)
        }
        val workspace = session.currentWorkspace
        return AccountsUiState.Ready(
            edition = workspace.type,
            overview = overview.withOverrides(localState.toggleOverrides),
            currency = workspace.currency,
            formatter = formatterFor(workspace.currency),
            permissions = session.permissions,
            limits = session.entitlements.limits,
            syncingConnectionIds = localState.syncingConnectionIds,
            disconnectingConnectionIds = localState.disconnectingConnectionIds,
            pendingAccountToggles = localState.pendingAccountToggles,
            isRefreshing = localState.isRefreshing,
            selectedProviderId = localState.selectedProviderId,
        )
    }

    /**
     * Drops optimistic overrides the server has caught up with.
     *
     * Without this an override would mask a later change made elsewhere — on
     * the web app, say — for as long as the screen lived. An override is kept
     * only while its write is in flight or while the cache still disagrees
     * with it.
     */
    private fun settleOptimisticToggles(overview: IntegrationsOverview?) {
        if (overview == null) return
        local.update { state ->
            if (state.toggleOverrides.isEmpty()) return@update state
            val server = overview.connections
                .flatMap { it.accounts }
                .associate { it.id to it.includeInTotals }
            val kept = state.toggleOverrides.filter { (accountId, value) ->
                accountId in state.pendingAccountToggles ||
                    (server.containsKey(accountId) && server[accountId] != value)
            }
            if (kept.size == state.toggleOverrides.size) {
                state
            } else {
                state.copy(toggleOverrides = kept)
            }
        }
    }

    private fun formatterFor(currency: String): MoneyFormatter =
        formatters.computeIfAbsent(currency.uppercase()) { MoneyFormatter(it) }

    private fun titleOf(connectionId: String): String {
        val state = uiState.value
        if (state !is AccountsUiState.Ready) return "Connection"
        return state.overview.connections
            .firstOrNull { it.id == connectionId }
            ?.title
            ?: "Connection"
    }

    private data class LocalState(
        val syncingConnectionIds: Set<String> = emptySet(),
        val disconnectingConnectionIds: Set<String> = emptySet(),
        val pendingAccountToggles: Set<String> = emptySet(),
        /** Account id to the value the user just chose, ahead of the server. */
        val toggleOverrides: Map<String, Boolean> = emptyMap(),
        val isRefreshing: Boolean = false,
        val selectedProviderId: String? = null,
        val loadError: String? = null,
    )

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}

private fun Throwable.messageOr(fallback: String): String =
    message?.takeIf { it.isNotBlank() } ?: fallback

private fun IntegrationsOverview.withOverrides(
    overrides: Map<String, Boolean>,
): IntegrationsOverview {
    if (overrides.isEmpty()) return this
    return copy(
        connections = connections.map { connection ->
            connection.copy(
                accounts = connection.accounts.map { account ->
                    val override = overrides[account.id]
                    if (override == null || override == account.includeInTotals) {
                        account
                    } else {
                        account.copy(includeInTotals = override)
                    }
                },
            )
        },
    )
}
