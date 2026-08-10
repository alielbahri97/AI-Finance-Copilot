package com.ballastmoney.android.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.domain.DashboardRepository
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.SessionBootstrap
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The only stateful object in this package.
 *
 * Reads are two cold flows joined into one [StateFlow]; writes are the single
 * [refresh] entry point. Nothing else can change what the screen shows, which
 * is the whole point of the unidirectional shape: given a [DashboardUiState] you
 * can reproduce the screen exactly, on a device or in a preview.
 *
 * Failure handling is the part worth reading. A refresh that fails while there
 * is cached data on screen must not blank the page — the numbers a user was
 * looking at a second ago are still the best information available. So a failure
 * only becomes [DashboardUiState.Error] when there is nothing to render;
 * otherwise it is swallowed and the only visible effect is [isRefreshing]
 * turning off again.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val dashboardRepository: DashboardRepository,
) : ViewModel() {

    private val isRefreshing = MutableStateFlow(false)
    private val loadFailure = MutableStateFlow<String?>(null)

    /**
     * One [MoneyFormatter] per currency, not one per emission. Each instance
     * builds a `NumberFormat` and three `DateTimeFormatter`s, and [buildState]
     * runs on every cache write. Declared before [uiState] so it cannot be read
     * before initialisation.
     */
    private var cachedFormatter: Pair<String, MoneyFormatter>? = null

    /**
     * The session, mirrored into hot state.
     *
     * Two reasons, both practical. [refresh] needs the current workspace id
     * synchronously, and it must not collect the repository flow to get it: per
     * the repository contract that flow may emit nothing at all until the first
     * successful bootstrap, so a `first()` inside a click handler could hang for
     * as long as the network does. And mirroring once means the repository flow
     * is collected exactly once for the lifetime of the ViewModel rather than
     * once per downstream that needs it.
     */
    private val session = MutableStateFlow<SessionBootstrap?>(null)

    private val workspaceId: Flow<String?> =
        session.map { it?.currentWorkspace?.id }.distinctUntilChanged()

    /**
     * The dashboard for whichever workspace is current, re-pointed when the
     * session says the workspace changed.
     *
     * A function rather than a property so the opt-in below unambiguously covers
     * the body: `@OptIn` on a property has not always applied to its
     * initialiser expression.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun snapshots(): Flow<DashboardSnapshot?> =
        workspaceId.flatMapLatest { id ->
            if (id == null) flowOf(null) else dashboardRepository.dashboard(id)
        }

    val uiState: StateFlow<DashboardUiState> = combine(
        session,
        snapshots(),
        isRefreshing,
        loadFailure,
    ) { bootstrap, snapshot, refreshing, failure ->
        buildState(bootstrap, snapshot, refreshing, failure)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = DashboardUiState.Loading,
    )

    init {
        viewModelScope.launch {
            sessionRepository.session.collect { session.value = it }
        }
        // Load on the first workspace *and* on every workspace switch. The
        // snapshot flow re-points itself when the id changes, but a workspace
        // whose dashboard has never been fetched has an empty cache, so
        // something has to ask the network for it.
        viewModelScope.launch {
            workspaceId.filterNotNull().collect { id ->
                dashboardRepository.refresh(id).onFailure(::recordFailure)
            }
        }
        viewModelScope.launch {
            sessionRepository.refresh().onFailure(::recordFailure)
        }
    }

    /**
     * Re-fetches the session and the dashboard. Safe to call repeatedly; the
     * repositories are responsible for collapsing concurrent requests.
     */
    fun refresh() {
        viewModelScope.launch {
            isRefreshing.value = true
            loadFailure.value = null
            val sessionFailure = sessionRepository.refresh().exceptionOrNull()
            val dashboardFailure = session.value?.currentWorkspace?.id
                ?.let { dashboardRepository.refresh(it).exceptionOrNull() }
            val failure = sessionFailure ?: dashboardFailure
            if (failure != null) recordFailure(failure)
            isRefreshing.value = false
        }
    }

    private fun recordFailure(error: Throwable) {
        loadFailure.value = error.message?.takeIf { it.isNotBlank() }
            ?: DashboardCopy.GENERIC_ERROR
    }

    private fun buildState(
        bootstrap: SessionBootstrap?,
        snapshot: DashboardSnapshot?,
        refreshing: Boolean,
        failure: String?,
    ): DashboardUiState {
        if (bootstrap == null || snapshot == null) {
            return if (failure != null) {
                DashboardUiState.Error(failure)
            } else {
                DashboardUiState.Loading
            }
        }
        val edition = bootstrap.currentWorkspace.type
        return DashboardUiState.Ready(
            edition = edition,
            greeting = DashboardCopy.greetingFor(bootstrap.profile),
            subtitle = DashboardCopy.subtitleFor(edition),
            snapshot = snapshot,
            // The snapshot carries the currency it was computed in. Falling back
            // to the workspace keeps amounts formatted if a future payload ever
            // drops the field.
            formatter = formatterFor(
                snapshot.currency.ifBlank { bootstrap.currentWorkspace.currency },
            ),
            permissions = bootstrap.permissions,
            limits = bootstrap.entitlements.limits,
            isRefreshing = refreshing,
        )
    }

    private fun formatterFor(currency: String): MoneyFormatter {
        cachedFormatter?.let { (code, cached) -> if (code == currency) return cached }
        val formatter = MoneyFormatter(currency)
        cachedFormatter = currency to formatter
        return formatter
    }

    private companion object {
        /**
         * Survives a configuration change without tearing down the upstream
         * collections, and drops them shortly after the screen really goes away.
         */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
