package com.ballastmoney.android.ui.bank

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.data.bank.BankConnectionRepository
import com.ballastmoney.android.data.bank.BankFinalizeOutcome
import com.ballastmoney.android.data.bank.BankGiveUpReason
import com.ballastmoney.android.data.bank.BankWaitReason
import com.ballastmoney.android.data.bank.ConnectedBank
import com.ballastmoney.android.data.bank.PendingBankConnection
import com.ballastmoney.android.data.bank.PendingBankConnectionStore
import com.ballastmoney.android.data.bank.finalizePending
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import java.time.Instant
import javax.inject.Inject

/** How a bank-connection notice should be dressed. Never error styling. */
enum class BankNoticeTone { INFO, WARNING, SUCCESS }

/** A line about an outstanding or just-finished connection attempt. */
@Immutable
data class BankNotice(
    val title: String,
    val description: String? = null,
    val tone: BankNoticeTone = BankNoticeTone.INFO,
)

/**
 * What the accounts screen shows about a connection attempt in flight.
 *
 * [pending] is read from disk rather than remembered, so this is the same after
 * the process has been killed and restarted as it was before.
 */
@Immutable
data class BankConnectUiState(
    val pending: PendingBankConnection? = null,
    val checking: Boolean = false,
    val waitReason: BankWaitReason? = null,
    val notice: BankNotice? = null,
) {
    val hasPending: Boolean get() = pending != null

    /** True while there is something for the user to be told about at all. */
    val visible: Boolean get() = pending != null || notice != null
}

/**
 * Finishes bank connections the user started.
 *
 * This is the resume half of the flow, and it is a separate ViewModel from the
 * picker for a reason: the attempt it is finishing may have been started by a
 * process that no longer exists. It reads the pending record from disk, so it
 * works identically whether the user came back after ten seconds or after
 * Android killed the app behind the browser.
 *
 * ### Why `finalize` is called unconditionally on resume
 *
 * The app cannot see how the bank's redirect went. The bank returns to the *web*
 * callback, so the Custom Tab may show a finished page, a web sign-in page, or
 * an error, and none of the three says anything reliable about the connection.
 * `finalize` is idempotent and its idempotent path is checked before its expiry
 * check, so one unconditional call answers the question correctly in every case
 * — including the one where the web callback already finished the job, and the
 * one where the window has closed but the connection exists anyway.
 *
 * ### Why there is no timer
 *
 * One call per resume, plus a button. A repeating poll was considered and
 * rejected: nothing changes server-side while the app is in the foreground and
 * the browser is not, so a timer would spend battery and quota re-asking a
 * question whose answer can only change when the user goes back to their bank —
 * which they cannot do without leaving the app, which produces another resume.
 */
@HiltViewModel
class BankConnectViewModel @Inject constructor(
    private val repository: BankConnectionRepository,
    private val pendingStore: PendingBankConnectionStore,
) : ViewModel() {

    private val local = MutableStateFlow(LocalState())

    private val _connections = Channel<ConnectedBank>(Channel.BUFFERED)

    /**
     * Emits once per connection that completed here, so the accounts screen can
     * refresh: the new connection only appears in `GET /api/integrations`, which
     * another repository owns and which has no idea this happened.
     */
    val connections: Flow<ConnectedBank> = _connections.receiveAsFlow()

    /**
     * Serialises the polls. Two resumes in quick succession — a configuration
     * change while the tab closes is enough — would otherwise redeem the same
     * reference twice and race over clearing it.
     */
    private val pollLock = Mutex()

    val state: StateFlow<BankConnectUiState> = combine(
        pendingStore.pending,
        local,
    ) { pending, localState ->
        BankConnectUiState(
            pending = pending,
            checking = localState.checking,
            waitReason = localState.waitReason,
            notice = localState.notice ?: pending?.let(::waitingNotice),
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = BankConnectUiState(),
    )

    private val _tabDismissals = Channel<Unit>(Channel.CONFLATED)

    /**
     * Emits once per resume that followed a Custom Tab this process opened, for
     * the host to stand the tab down.
     *
     * A channel rather than a field in [state]: dismissing a tab is a side effect
     * that must happen exactly once, and a boolean rendered from state would
     * re-fire it on every recomposition. Conflated because two of these mean the
     * same thing as one.
     */
    val tabDismissals: Flow<Unit> = _tabDismissals.receiveAsFlow()

    /** Called when a consent page has been handed to a browser. */
    fun onConsentTabOpened() {
        local.update { it.copy(tabOpen = true, notice = null, waitReason = null) }
    }

    /**
     * The app came back to the foreground.
     *
     * [now] is a parameter so the expiry decision can be driven in a test without
     * waiting half an hour.
     */
    fun onResumed(now: Instant = Instant.now()) {
        if (local.value.tabOpen) {
            local.update { it.copy(tabOpen = false) }
            _tabDismissals.trySend(Unit)
        }
        viewModelScope.launch { poll(now) }
    }

    /** The "Check again" button. */
    fun checkNow() {
        viewModelScope.launch { poll(Instant.now()) }
    }

    /** Dismisses whatever the last attempt had to say. */
    fun dismissNotice() {
        local.update { it.copy(notice = null) }
    }

    /**
     * Abandons the attempt on the user's say-so.
     *
     * Only the local record goes: the pending row at the server keeps its own
     * thirty-minute clock, and there is no endpoint to cancel it. That is the
     * right division — the user is saying "stop telling me about this", not
     * "revoke what I approved at my bank", and if the approval does land the
     * connection will simply appear on its own.
     */
    fun stopWaiting() {
        viewModelScope.launch {
            pendingStore.clear()
            local.update { it.copy(waitReason = null, notice = null) }
        }
    }

    private suspend fun poll(now: Instant) {
        // A second concurrent poll is dropped rather than queued: it would ask
        // the same question about the same reference a moment later.
        if (!pollLock.tryLock()) return
        try {
            // Read first, so a resume with nothing outstanding — which is almost
            // every resume — does not flash a spinner on the card.
            if (pendingStore.current() == null) return
            local.update { it.copy(checking = true) }
            val result = finalizePending(
                repository = repository,
                store = pendingStore,
                now = now,
            ) ?: return
            applyOutcome(result.outcome, result.pending)
        } finally {
            local.update { it.copy(checking = false) }
            pollLock.unlock()
        }
    }

    private suspend fun applyOutcome(
        outcome: BankFinalizeOutcome,
        pending: PendingBankConnection,
    ) {
        when (outcome) {
            is BankFinalizeOutcome.Connected -> {
                val notice = connectedNotice(outcome.connection, pending)
                local.update { it.copy(waitReason = null, notice = notice) }
                _connections.send(outcome.connection)
            }

            is BankFinalizeOutcome.Waiting ->
                local.update { it.copy(waitReason = outcome.reason, notice = null) }

            is BankFinalizeOutcome.GaveUp -> local.update {
                it.copy(
                    waitReason = null,
                    notice = BankNotice(
                        title = gaveUpTitle(outcome.reason, pending),
                        description = outcome.message,
                        tone = BankNoticeTone.WARNING,
                    ),
                )
            }

            // Deliberately silent. The attempt is intact, the next resume will
            // ask again, and a snackbar about a failed background poll would be
            // noise about something the user did not ask for.
            is BankFinalizeOutcome.Retry -> local.update { it.copy(waitReason = null) }
        }
    }

    private data class LocalState(
        val checking: Boolean = false,
        val waitReason: BankWaitReason? = null,
        val notice: BankNotice? = null,
        val tabOpen: Boolean = false,
    )

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}

/** The standing "we are waiting for your bank" line, shown while a record exists. */
internal fun waitingNotice(pending: PendingBankConnection): BankNotice = BankNotice(
    title = "Waiting for ${pending.institutionName}",
    description = "Finish approving access at your bank. Ballast checks again each time " +
        "you come back, so there is nothing to remember.",
    tone = BankNoticeTone.INFO,
)

internal fun connectedNotice(
    connection: ConnectedBank,
    pending: PendingBankConnection,
): BankNotice {
    val name = connection.institutionName?.takeIf { it.isNotBlank() } ?: pending.institutionName
    val accounts = when (connection.accountCount) {
        0 -> "The first import will bring its accounts in."
        1 -> "One account is now syncing."
        else -> "${connection.accountCount} accounts are now syncing."
    }
    return BankNotice(
        title = "$name connected",
        description = accounts,
        tone = BankNoticeTone.SUCCESS,
    )
}

internal fun gaveUpTitle(reason: BankGiveUpReason, pending: PendingBankConnection): String =
    when (reason) {
        BankGiveUpReason.EXPIRED -> "${pending.institutionName} wasn't connected"
        BankGiveUpReason.NEVER_APPROVED -> "${pending.institutionName} wasn't connected"
        BankGiveUpReason.REFUSED -> "Ballast couldn't connect ${pending.institutionName}"
    }

/** The line under the waiting card, which changes once the bank has said something. */
internal fun waitReasonText(reason: BankWaitReason?): String? = when (reason) {
    null -> null
    BankWaitReason.NOT_YET_APPROVED ->
        "Your bank hasn't confirmed the approval yet. This can take a minute."

    BankWaitReason.NOT_COMPLETED_AT_BANK ->
        "Your bank hasn't confirmed that the approval was finished. If you closed the " +
            "page early, connect again."
}
