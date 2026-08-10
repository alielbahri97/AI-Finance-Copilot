package com.ballastmoney.android.ui.bank

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.data.bank.BankConnectionRepository
import com.ballastmoney.android.data.bank.BankInstitution
import com.ballastmoney.android.data.bank.PendingBankConnectionStore
import com.ballastmoney.android.data.remote.BallastApiError
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Choosing a country, then a bank, then minting the consent link.
 *
 * The picker's own ViewModel rather than more state on `AccountsViewModel`,
 * because it has a different lifetime and a different failure surface: it is
 * created when the sheet opens, its list is thrown away when the sheet closes,
 * and none of what it loads belongs on the accounts screen. `AccountsViewModel`
 * also lives as long as the tab, which would keep a stale institution list for a
 * country the user has since changed.
 *
 * The pending record is written here, before [consentLaunches] emits, so it is on
 * disk before any browser can be opened. Doing it the other way round leaves a
 * window in which the process is killed with a reference that only exists in a
 * ViewModel — which is precisely the case this whole flow is built around.
 */
@HiltViewModel
class BankPickerViewModel @Inject constructor(
    private val repository: BankConnectionRepository,
    private val pendingStore: PendingBankConnectionStore,
) : ViewModel() {

    private val _state = MutableStateFlow(BankPickerUiState(country = BankCountries.defaultCode()))
    val state: StateFlow<BankPickerUiState> = _state.asStateFlow()

    private val _consentLaunches = Channel<BankConsentLaunch>(Channel.BUFFERED)

    /**
     * Consent pages to open, one per successful `link` call.
     *
     * A channel rather than state: opening a browser is an event, and a state
     * field holding a URL would fire again on every recomposition and on
     * rotation, which would mean two tabs for one tap.
     */
    val consentLaunches: Flow<BankConsentLaunch> = _consentLaunches.receiveAsFlow()

    init {
        loadInstitutions(_state.value.country)
    }

    fun onQueryChange(query: String) {
        _state.update { it.copy(query = query) }
    }

    /** Opens the country list, clearing the bank search so it starts fresh. */
    fun onChangeCountry() {
        _state.update { it.copy(step = BankPickerStep.COUNTRY, query = "") }
    }

    fun onCountrySelected(code: String) {
        val current = _state.value
        _state.update { it.copy(country = code, step = BankPickerStep.INSTITUTION, query = "") }
        // Re-fetching the same country would throw away a good list to show a
        // spinner and get it back, and the server caches per country anyway.
        if (code != current.country || current.institutions.isEmpty()) {
            loadInstitutions(code)
        }
    }

    /** Leaves the country list without changing anything. */
    fun onCancelCountry() {
        _state.update { it.copy(step = BankPickerStep.INSTITUTION, query = "") }
    }

    fun retryLoad() {
        loadInstitutions(_state.value.country)
    }

    fun dismissStartError() {
        _state.update { it.copy(startError = null) }
    }

    /**
     * Mints a link for [institution] and asks the host to open it.
     *
     * Guarded against a second tap: `POST /link` creates a requisition at
     * GoCardless and counts against the workspace's connection quota, so two
     * taps would spend two of them and leave one requisition that can never be
     * finalized.
     */
    fun onInstitutionSelected(institution: BankInstitution) {
        if (_state.value.starting) return
        _state.update { it.copy(startingInstitutionId = institution.id, startError = null) }
        viewModelScope.launch {
            repository.startLink(institutionId = institution.id, institutionName = institution.name)
                .onSuccess { start ->
                    pendingStore.save(start.pending)
                    _state.update { it.copy(startingInstitutionId = null) }
                    _consentLaunches.send(
                        BankConsentLaunch(url = start.consentUrl, pending = start.pending),
                    )
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(
                            startingInstitutionId = null,
                            startError = startFailureMessage(error),
                        )
                    }
                }
        }
    }

    /**
     * Reports how the launch went. Only a device with nothing to open a web page
     * is worth saying anything about; a plain browser instead of a Custom Tab is
     * a difference the user does not need explained.
     */
    fun onConsentTabResult(result: ConsentTabResult) {
        if (result is ConsentTabResult.NoBrowser) {
            _state.update { it.copy(startError = result.message) }
            viewModelScope.launch {
                // Nothing can finalize an attempt whose consent page was never
                // opened, so the record would only produce thirty minutes of
                // pointless polling and a "wasn't approved in time" notice.
                pendingStore.clear()
            }
        }
    }

    private fun loadInstitutions(country: String) {
        _state.update {
            it.copy(loading = true, loadError = null, loadErrorRetryable = true)
        }
        viewModelScope.launch {
            repository.institutions(country)
                .onSuccess { institutions ->
                    val sorted = institutions.sortedBy { bank -> bank.name.lowercase() }
                    _state.update { current ->
                        // A slow first country answering after the user has moved
                        // on must not replace the list they are looking at.
                        if (current.country != country) {
                            current
                        } else {
                            current.copy(loading = false, institutions = sorted, loadError = null)
                        }
                    }
                }
                .onFailure { error ->
                    _state.update { current ->
                        if (current.country != country) {
                            current
                        } else {
                            current.copy(
                                loading = false,
                                institutions = emptyList(),
                                loadError = loadFailureMessage(error),
                                loadErrorRetryable = isRetryable(error),
                            )
                        }
                    }
                }
        }
    }
}

/**
 * Copy for a failed institutions load.
 *
 * The server's own message is preferred wherever it wrote one for a person; the
 * two cases handled specially are the ones where it did not. A `503` arrives as
 * [BallastApiError.Server] and means GoCardless is not configured on this
 * deployment, which is an administrator's problem and should not read as
 * "something went wrong"; a `429` is GoCardless throttling the *list*, which
 * resolves on its own.
 */
internal fun loadFailureMessage(error: Throwable): String = when {
    error is BallastApiError.Server && error.status == HTTP_SERVICE_UNAVAILABLE ->
        "Bank connections aren't set up on this Ballast server yet. Ask your " +
            "administrator to configure them."

    error is BallastApiError.RateLimited ->
        "Your bank list is temporarily unavailable because of a provider limit. " +
            "Try again in a few minutes."

    else -> error.message?.takeIf { it.isNotBlank() } ?: "Couldn't load the list of banks."
}

/** Copy for a failed `POST /link`. */
internal fun startFailureMessage(error: Throwable): String = when (error) {
    is BallastApiError.Paywalled -> error.message
    is BallastApiError.Forbidden -> error.message
    else -> error.message?.takeIf { it.isNotBlank() }
        ?: "Couldn't start the connection to that bank."
}

/**
 * Whether a retry button belongs under the failure.
 *
 * A permission wall, a paywall and a not-configured server all answer the same
 * way however many times they are asked, and a button that cannot work is worse
 * than no button.
 */
internal fun isRetryable(error: Throwable): Boolean = when {
    error is BallastApiError.Forbidden -> false
    error is BallastApiError.Paywalled -> false
    error is BallastApiError.WrongEdition -> false
    error is BallastApiError.Server && error.status == HTTP_SERVICE_UNAVAILABLE -> false
    else -> true
}

private const val HTTP_SERVICE_UNAVAILABLE = 503
