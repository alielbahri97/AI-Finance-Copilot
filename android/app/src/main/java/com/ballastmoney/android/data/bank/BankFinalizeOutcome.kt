package com.ballastmoney.android.data.bank

import com.ballastmoney.android.data.remote.BallastApiError
import java.time.Instant

/**
 * What to do about the answer `finalize` gave, worked out without touching
 * Android or Compose.
 *
 * The decision is genuinely subtle and worth having in one testable place: most
 * of the failures this endpoint returns are not faults at all but stages of a
 * user wandering off, and the difference between "keep quiet and check again
 * later" and "tell them it is over" is the difference between a flow that
 * finishes itself and one that nags for ever.
 */

/** Why an attempt has not produced a connection yet, but still might. */
enum class BankWaitReason {
    /**
     * `404 NOT_FOUND`. No pending attempt matched — which for an unexpired
     * reference means the approval has not landed at GoCardless yet, not that
     * anything is wrong.
     */
    NOT_YET_APPROVED,

    /**
     * `502`. GoCardless refused to finalize the requisition, which is what it
     * says when the user has not finished at the bank.
     *
     * Read as "not yet" only for as long as the window lasts, and with a caveat
     * worth knowing: the server marks the pending row FAILED when it returns
     * this, so the next poll answers `410` and the attempt ends. The wait state
     * therefore says the approval has not come through rather than promising
     * that carrying on in the tab will work.
     */
    NOT_COMPLETED_AT_BANK,
}

/** Why an attempt was abandoned for good. The pending record is cleared. */
enum class BankGiveUpReason {
    /** `410`, or a local clock past the expiry. The window has closed. */
    EXPIRED,

    /** Out of time with the approval never having reached GoCardless. */
    NEVER_APPROVED,

    /**
     * The server will never accept this reference: the permission is missing,
     * the plan is spent, the body was rejected. Retrying cannot change any of
     * those, so the attempt is dropped and the server's own message is shown.
     */
    REFUSED,
}

sealed interface BankFinalizeOutcome {

    /** The connection exists. Either this call made it, or the web callback did. */
    data class Connected(val connection: ConnectedBank) : BankFinalizeOutcome

    /** Keep the record, say nothing unless the user asked. */
    data class Waiting(val reason: BankWaitReason) : BankFinalizeOutcome

    /** Forget the record and tell the user, once. */
    data class GaveUp(val reason: BankGiveUpReason, val message: String) : BankFinalizeOutcome

    /** Transport or server trouble. Keep the record; this says nothing about the bank. */
    data class Retry(val message: String) : BankFinalizeOutcome
}

/**
 * Whether the pending record should be forgotten.
 *
 * Only the two terminal outcomes clear it. Clearing on [BankFinalizeOutcome.Retry]
 * would lose a perfectly good attempt to a moment of no signal, which is exactly
 * when a user is most likely to be resuming the app.
 */
val BankFinalizeOutcome.clearsPending: Boolean
    get() = when (this) {
        is BankFinalizeOutcome.Connected -> true
        is BankFinalizeOutcome.GaveUp -> true
        is BankFinalizeOutcome.Waiting -> false
        is BankFinalizeOutcome.Retry -> false
    }

/** One poll, and the attempt it was about. */
data class BankPollResult(
    val pending: PendingBankConnection,
    val outcome: BankFinalizeOutcome,
)

/**
 * Redeems whatever is outstanding, and forgets it if that was the end of it.
 *
 * A plain function taking both collaborators rather than a method on either: the
 * repository has no business knowing where the reference is kept, and the store
 * has no business making network calls. Keeping the sequence here — read, call,
 * classify, maybe clear — means the whole resume rule can be exercised in a JVM
 * test with a faked store, which is the one part of this flow that would
 * otherwise need an Android context to check.
 *
 * Returns null when there was nothing outstanding, which is the ordinary case.
 */
suspend fun finalizePending(
    repository: BankConnectionRepository,
    store: PendingBankConnectionStore,
    now: Instant = Instant.now(),
): BankPollResult? {
    val pending = store.current() ?: return null
    val outcome = classifyFinalize(
        result = repository.finalizeConnection(pending.reference),
        pending = pending,
        now = now,
    )
    if (outcome.clearsPending) store.clear()
    return BankPollResult(pending = pending, outcome = outcome)
}

/**
 * Classifies one `finalize` attempt.
 *
 * [now] is a parameter rather than read from the clock so the expiry boundary is
 * testable, and so a single poll cannot decide "expired" and "not expired" at two
 * points in the same function.
 *
 * The shape of the decision:
 *
 *  - Success is success, and says nothing about who finalized. If the web
 *    callback got there first this is its idempotent path returning the same
 *    connection, which is indistinguishable and correctly so.
 *  - `404` and `502` are read against the clock. Before expiry they mean the user
 *    is still somewhere in the bank's flow; after it they mean they never
 *    finished. The same status, two different conclusions, and the clock is the
 *    only thing that can tell them apart.
 *  - `410` is final whatever the clock says: the server has decided the attempt
 *    expired, or the connection it made has since been disconnected.
 *  - `403`, `402`, `400`, `409` and a wrong-edition `404` are refusals of the
 *    request itself. Polling them again would produce the same answer for the
 *    next thirty minutes.
 *  - Everything else — no network, a `401` the auth plugin could not repair, a
 *    `500`, an unreadable body — leaves the record alone. None of them is
 *    evidence about the bank.
 */
fun classifyFinalize(
    result: Result<ConnectedBank>,
    pending: PendingBankConnection,
    now: Instant,
): BankFinalizeOutcome {
    val connection = result.getOrNull()
    if (connection != null) return BankFinalizeOutcome.Connected(connection)

    val failure = result.exceptionOrNull()
    val error = failure as? BallastApiError
        ?: return BankFinalizeOutcome.Retry(
            failure?.message?.takeIf { it.isNotBlank() } ?: GENERIC_RETRY_MESSAGE,
        )
    val expired = pending.hasExpired(now)

    return when {
        error is BallastApiError.NotFound -> if (expired) {
            BankFinalizeOutcome.GaveUp(
                reason = BankGiveUpReason.NEVER_APPROVED,
                message = neverApprovedMessage(pending),
            )
        } else {
            BankFinalizeOutcome.Waiting(BankWaitReason.NOT_YET_APPROVED)
        }

        error is BallastApiError.Expired ->
            BankFinalizeOutcome.GaveUp(BankGiveUpReason.EXPIRED, error.message)

        error is BallastApiError.Server && error.status == HTTP_BAD_GATEWAY -> if (expired) {
            BankFinalizeOutcome.GaveUp(
                reason = BankGiveUpReason.NEVER_APPROVED,
                message = neverApprovedMessage(pending),
            )
        } else {
            BankFinalizeOutcome.Waiting(BankWaitReason.NOT_COMPLETED_AT_BANK)
        }

        error is BallastApiError.Forbidden ||
            error is BallastApiError.Paywalled ||
            error is BallastApiError.BadRequest ||
            error is BallastApiError.Conflict ||
            error is BallastApiError.WrongEdition ->
            BankFinalizeOutcome.GaveUp(BankGiveUpReason.REFUSED, error.message)

        // An unexpired attempt that only met transport trouble is worth another
        // resume; an expired one is not, whatever the last answer was, because
        // there is no longer anything a successful call could return.
        expired -> BankFinalizeOutcome.GaveUp(BankGiveUpReason.EXPIRED, expiredMessage(pending))

        else -> BankFinalizeOutcome.Retry(error.message)
    }
}

/**
 * Copy for the two abandonment cases the server does not phrase itself.
 *
 * Both name the bank and both offer the way forward, because "that did not work"
 * with no next step is the message users complain about.
 */
internal fun neverApprovedMessage(pending: PendingBankConnection): String =
    "The connection to ${pending.institutionName} wasn't approved in time. " +
        "Nothing was changed — connect again when you're ready."

internal fun expiredMessage(pending: PendingBankConnection): String =
    "The connection to ${pending.institutionName} has expired. Nothing was changed — " +
        "connect again when you're ready."

private const val HTTP_BAD_GATEWAY = 502

private const val GENERIC_RETRY_MESSAGE =
    "Ballast couldn't finish the bank connection just now. It will try again."
