package com.ballastmoney.android.data.bank

import java.time.Instant

/**
 * The types the GoCardless bank-connection flow is expressed in.
 *
 * They live in `data/bank` rather than in `core/model` because `core/model` is
 * the shared domain another agent owns, and none of these outlive the connect
 * flow: once `finalize` succeeds the connection arrives through
 * `GET /api/integrations` as an `IntegrationConnection` like any other, and
 * everything here is discarded.
 */

/**
 * One bank offered for a country by
 * `GET /api/integrations/gocardless/institutions`.
 *
 * The server's own option shape is `{id, name, logo, historyDays}` while the
 * wire DTO this is mapped from also allows `bic` and `countries`. Whatever is
 * absent stays null: the picker needs a name to show and an id to post, and
 * treats the rest as decoration.
 */
data class BankInstitution(
    val id: String,
    val name: String,
    val logoUrl: String? = null,
    val bic: String? = null,
) {
    /**
     * Whether this bank should survive a search box.
     *
     * The id and BIC are matched as well as the name because a GoCardless id
     * reads as `ABNAMRO_ABNANL2A` — someone who knows their BIC, or who pasted
     * an id from a support thread, should find the row rather than be told
     * there are no matches.
     */
    fun matches(query: String): Boolean {
        val needle = query.trim()
        if (needle.isEmpty()) return true
        return name.contains(needle, ignoreCase = true) ||
            id.contains(needle, ignoreCase = true) ||
            bic?.contains(needle, ignoreCase = true) == true
    }
}

/**
 * What `POST /api/integrations/gocardless/link` produced: a page to send the
 * user to, and the record that has to outlive them going there.
 */
data class BankLinkStart(
    val consentUrl: String,
    val pending: PendingBankConnection,
)

/**
 * A bank connection that has been started but not finished.
 *
 * [reference] is the whole point of this type. It is the only thing that can
 * finalize the attempt, the bank's redirect goes to the *web* callback rather
 * than back into the app, and Android is free to kill this process while the
 * browser is in front — so the reference has to be on disk before the Custom
 * Tab opens, not merely in a ViewModel.
 *
 * [institutionName] is carried alongside so that the "waiting for ING" copy can
 * be written without another round trip, which would be a request the app
 * cannot make while it is offline or unauthenticated.
 */
data class PendingBankConnection(
    val reference: String,
    val institutionId: String,
    val institutionName: String,
    /** Thirty minutes out. After this the attempt cannot be finalized. */
    val expiresAt: Instant,
) {
    /**
     * True from [expiresAt] onwards, inclusive. The boundary is deliberately
     * "not before": at exactly the expiry instant the server will refuse, so
     * the client should agree rather than offer one more doomed attempt.
     */
    fun hasExpired(now: Instant): Boolean = !now.isBefore(expiresAt)
}

/**
 * A finished connection, as `POST /api/integrations/gocardless/finalize`
 * returned it.
 *
 * Only what the confirmation message needs is kept. Balances are usually null
 * at this point — they arrive with the first sync — so there is nothing worth
 * showing from the accounts beyond how many there are.
 */
data class ConnectedBank(
    val id: String,
    val institutionName: String?,
    val status: String,
    val accountCount: Int,
)
