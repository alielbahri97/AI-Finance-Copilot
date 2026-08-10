package com.ballastmoney.android.ui.bank

import androidx.compose.runtime.Immutable
import com.ballastmoney.android.data.bank.BankInstitution
import com.ballastmoney.android.data.bank.PendingBankConnection

/** Which half of the picker is showing. */
enum class BankPickerStep {
    /** Choosing a country, because `/institutions` is per country. */
    COUNTRY,

    /** Choosing a bank within the chosen country. */
    INSTITUTION,
}

/**
 * Everything the bank picker renders from.
 *
 * The two steps share one [query] field, cleared whenever the step changes. Two
 * separate query fields would have to be kept in step with each other for no
 * benefit — only one search box is ever on screen.
 *
 * The derived lists are properties rather than stored values so there is one copy
 * of the truth: a stored filtered list would have to be recomputed on every
 * keystroke anyway, and could go stale against [institutions].
 */
@Immutable
data class BankPickerUiState(
    /** Two-letter ISO code currently in play. */
    val country: String,
    val step: BankPickerStep = BankPickerStep.INSTITUTION,
    val query: String = "",
    val loading: Boolean = false,
    val institutions: List<BankInstitution> = emptyList(),
    val loadError: String? = null,
    /** False for a refusal a retry cannot fix, where a retry button would lie. */
    val loadErrorRetryable: Boolean = true,
    /** Non-null while `POST /link` is in flight for that institution. */
    val startingInstitutionId: String? = null,
    /** Why the last attempt to start a connection did not open a browser. */
    val startError: String? = null,
) {
    val countryName: String get() = BankCountries.nameFor(country)

    val institutionResults: List<BankInstitution>
        get() = if (query.isBlank()) institutions else institutions.filter { it.matches(query) }

    val countryResults: List<BankCountry> get() = BankCountries.search(query)

    val starting: Boolean get() = startingInstitutionId != null

    /** The country has banks, but none of them match what was typed. */
    val showNoMatches: Boolean
        get() = !loading &&
            loadError == null &&
            institutions.isNotEmpty() &&
            institutionResults.isEmpty()

    /** GoCardless lists no banks at all for this country. */
    val showNoBanksInCountry: Boolean
        get() = !loading && loadError == null && institutions.isEmpty()
}

/**
 * A consent page the picker wants opened, paired with the record that was written
 * to disk before this was emitted.
 *
 * The pending record travels with it so the host can name the bank in a failure
 * message without reading the store again.
 */
@Immutable
data class BankConsentLaunch(
    val url: String,
    val pending: PendingBankConnection,
)
