package com.ballastmoney.android.data.bank

import com.ballastmoney.android.data.remote.BallastApiError
import com.ballastmoney.android.data.remote.PaywallReason
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * What each answer from `finalize` means for the user.
 *
 * This is where abandonment is actually decided, and the decisions are not
 * obvious from the status codes: the same `404` means "your bank has not
 * confirmed yet" inside the thirty-minute window and "you never finished" outside
 * it. Getting it wrong in either direction is a bad bug — one direction nags
 * about an attempt that is over, the other gives up on one that is about to
 * succeed.
 */
class BankFinalizeOutcomeTest {

    @Test
    @DisplayName("a connection is a connection, whoever finalized it")
    fun success() {
        val outcome = classify(Result.success(CONNECTED), now = INSIDE_WINDOW)

        val connected = assertIs<BankFinalizeOutcome.Connected>(outcome)
        assertEquals("conn-ing", connected.connection.id)
        assertTrue(outcome.clearsPending)
    }

    @Test
    @DisplayName("404 inside the window means not yet approved, and the record is kept")
    fun notFoundBeforeExpiry() {
        val outcome = classify(
            failure(BallastApiError.NotFound("No pending bank connection.", "NOT_FOUND")),
            now = INSIDE_WINDOW,
        )

        val waiting = assertIs<BankFinalizeOutcome.Waiting>(outcome)
        assertEquals(BankWaitReason.NOT_YET_APPROVED, waiting.reason)
        assertFalse(outcome.clearsPending)
    }

    @Test
    @DisplayName("404 past the window means it was never approved, and the nagging stops")
    fun notFoundAfterExpiry() {
        val outcome = classify(
            failure(BallastApiError.NotFound("No pending bank connection.", "NOT_FOUND")),
            now = PAST_WINDOW,
        )

        val gaveUp = assertIs<BankFinalizeOutcome.GaveUp>(outcome)
        assertEquals(BankGiveUpReason.NEVER_APPROVED, gaveUp.reason)
        assertTrue(outcome.clearsPending)
        // The user is told which bank and that nothing was changed, not a status.
        assertTrue(gaveUp.message.contains("ING"), "the bank was not named: ${gaveUp.message}")
        assertTrue(
            gaveUp.message.contains("Nothing was changed"),
            "the reassurance was lost: ${gaveUp.message}",
        )
    }

    @Test
    @DisplayName("410 is final whatever the clock says, and keeps the server's own reason")
    fun goneIsAlwaysFinal() {
        val message = "The bank approval took too long and the attempt expired. Connect again."

        val inside = classify(failure(BallastApiError.Expired(message)), now = INSIDE_WINDOW)
        val outside = classify(failure(BallastApiError.Expired(message)), now = PAST_WINDOW)

        for (outcome in listOf(inside, outside)) {
            val gaveUp = assertIs<BankFinalizeOutcome.GaveUp>(outcome)
            assertEquals(BankGiveUpReason.EXPIRED, gaveUp.reason)
            assertEquals(message, gaveUp.message)
            assertTrue(outcome.clearsPending)
        }
    }

    @Test
    @DisplayName("502 inside the window is a wait; past it, the approval never happened")
    fun badGatewayDependsOnTheClock() {
        val error = BallastApiError.Server("The bank approval was not completed.", 502)

        val waiting = assertIs<BankFinalizeOutcome.Waiting>(
            classify(failure(error), now = INSIDE_WINDOW),
        )
        assertEquals(BankWaitReason.NOT_COMPLETED_AT_BANK, waiting.reason)

        val gaveUp = assertIs<BankFinalizeOutcome.GaveUp>(
            classify(failure(error), now = PAST_WINDOW),
        )
        assertEquals(BankGiveUpReason.NEVER_APPROVED, gaveUp.reason)
    }

    @Test
    @DisplayName("a 500 is not evidence about the bank, so the attempt survives it")
    fun serverErrorIsRetried() {
        val outcome = classify(
            failure(BallastApiError.Server("Ballast had a problem.", 500)),
            now = INSIDE_WINDOW,
        )

        assertIs<BankFinalizeOutcome.Retry>(outcome)
        assertFalse(outcome.clearsPending)
    }

    @Test
    @DisplayName("no connectivity keeps the attempt; the next resume asks again")
    fun networkFailureIsRetried() {
        val outcome = classify(failure(BallastApiError.Network()), now = INSIDE_WINDOW)

        assertIs<BankFinalizeOutcome.Retry>(outcome)
        assertFalse(outcome.clearsPending)
    }

    @Test
    @DisplayName("no connectivity past the window is still over: nothing could be returned now")
    fun networkFailureAfterExpiryGivesUp() {
        val outcome = classify(failure(BallastApiError.Network()), now = PAST_WINDOW)

        val gaveUp = assertIs<BankFinalizeOutcome.GaveUp>(outcome)
        assertEquals(BankGiveUpReason.EXPIRED, gaveUp.reason)
    }

    @Test
    @DisplayName("a refusal of the request itself is not worth asking again")
    fun refusalsAreFinal() {
        val forbidden = classify(
            failure(BallastApiError.Forbidden("You need Manage integrations.")),
            now = INSIDE_WINDOW,
        )
        val paywalled = classify(
            failure(
                BallastApiError.Paywalled(
                    message = "Your plan includes 3 bank connections.",
                    reason = PaywallReason.LIMIT_REACHED,
                ),
            ),
            now = INSIDE_WINDOW,
        )

        for (outcome in listOf(forbidden, paywalled)) {
            val gaveUp = assertIs<BankFinalizeOutcome.GaveUp>(outcome)
            assertEquals(BankGiveUpReason.REFUSED, gaveUp.reason)
            // The server wrote these for a person; they are shown as they are.
            assertTrue(gaveUp.message.isNotBlank())
        }
    }

    @Test
    @DisplayName("an untyped failure is a retry rather than a mystery given to the user")
    fun untypedFailure() {
        val outcome = classify(Result.failure(IllegalStateException("boom")), now = INSIDE_WINDOW)

        assertIs<BankFinalizeOutcome.Retry>(outcome)
    }

    @Test
    @DisplayName("the expiry boundary is inclusive: at the instant itself the attempt is over")
    fun expiryBoundaryIsInclusive() {
        assertTrue(PENDING.hasExpired(PENDING.expiresAt))
        assertFalse(PENDING.hasExpired(PENDING.expiresAt.minusMillis(1)))
    }

    @Test
    @DisplayName("a poll with nothing outstanding does nothing at all")
    fun pollWithoutPending() = runTest {
        val store = FakePendingBankConnectionStore()

        val result = finalizePending(
            repository = failingRepository(),
            store = store,
            now = INSIDE_WINDOW,
        )

        assertNull(result)
    }

    @Test
    @DisplayName("a successful poll forgets the reference, so it is never redeemed twice")
    fun successfulPollClearsTheRecord() = runTest {
        val store = FakePendingBankConnectionStore()
        store.save(PENDING)

        val result = finalizePending(
            repository = connectingRepository(),
            store = store,
            now = INSIDE_WINDOW,
        )

        assertNotNull(result)
        assertIs<BankFinalizeOutcome.Connected>(result?.outcome)
        assertNull(store.current())
    }

    @Test
    @DisplayName("a poll that is only waiting leaves the reference on disk for the next resume")
    fun waitingPollKeepsTheRecord() = runTest {
        val store = FakePendingBankConnectionStore()
        store.save(PENDING)

        val result = finalizePending(
            repository = notFoundRepository(),
            store = store,
            now = INSIDE_WINDOW,
        )

        assertIs<BankFinalizeOutcome.Waiting>(result?.outcome)
        assertEquals(PENDING, store.current())
    }

    @Test
    @DisplayName("a poll past the window clears the reference even though the call failed")
    fun expiredPollClearsTheRecord() = runTest {
        val store = FakePendingBankConnectionStore()
        store.save(PENDING)

        val result = finalizePending(
            repository = notFoundRepository(),
            store = store,
            now = PAST_WINDOW,
        )

        assertIs<BankFinalizeOutcome.GaveUp>(result?.outcome)
        assertNull(store.current())
    }

    private fun classify(
        result: Result<ConnectedBank>,
        now: Instant,
    ): BankFinalizeOutcome = classifyFinalize(result = result, pending = PENDING, now = now)

    private fun failure(error: BallastApiError): Result<ConnectedBank> = Result.failure(error)

    private companion object {
        val PENDING = PendingBankConnection(
            reference = "ballast-ws1-1786000000000-6f2a1b",
            institutionId = "ING_INGBNL2A",
            institutionName = "ING",
            expiresAt = Instant.parse("2026-08-10T08:00:00Z"),
        )

        val INSIDE_WINDOW: Instant = Instant.parse("2026-08-10T07:45:00Z")
        val PAST_WINDOW: Instant = Instant.parse("2026-08-10T08:30:00Z")

        val CONNECTED = ConnectedBank(
            id = "conn-ing",
            institutionName = "ING",
            status = "CONNECTED",
            accountCount = 2,
        )
    }
}
