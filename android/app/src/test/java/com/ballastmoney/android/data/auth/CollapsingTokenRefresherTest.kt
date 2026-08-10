package com.ballastmoney.android.data.auth

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * The rule that stops a burst of `401`s signing the user out.
 *
 * This is [SupabaseAuthGateway.refreshAccessToken]'s whole behaviour, tested
 * where it lives rather than through the gateway: the gateway adds nothing but
 * a supabase-kt client to it, and a test that needed one of those would need a
 * Supabase project, a network and an Android keystore to prove a claim about a
 * mutex.
 *
 * The stake is real. Supabase rotates the refresh token on every use, so two
 * refreshes racing means the second presents a token the first has already
 * spent, and the session dies — the user is signed out by their own app loading
 * a screen.
 */
class CollapsingTokenRefresherTest {

    @Test
    @DisplayName("four simultaneous callers cause exactly one refresh")
    fun concurrentCallersCollapse() = runTest {
        var token: String? = "expired"
        val refreshes = AtomicInteger(0)
        val refresher = CollapsingTokenRefresher(
            readToken = { token },
            performRefresh = {
                refreshes.incrementAndGet()
                // Long enough that the other three arrive while it is in
                // flight, which is the whole situation being tested.
                delay(REFRESH_MILLIS)
                token = "renewed"
            },
        )

        val results = (1..FOUR_REQUESTS).map { async { refresher.refresh() } }.awaitAll()

        assertEquals(1, refreshes.get(), "one refresh, not one per caller")
        assertTrue(
            results.all { it == "renewed" },
            "every caller gets the new token, not just the one that did the work: $results",
        )
    }

    @Test
    @DisplayName("a caller that finds the token already changed does not refresh again")
    fun staleCallerSeesTheNewToken() = runTest {
        var token: String? = "expired"
        val refreshes = AtomicInteger(0)
        val refresher = CollapsingTokenRefresher(
            readToken = { token },
            performRefresh = {
                refreshes.incrementAndGet()
                token = "renewed"
            },
        )

        assertEquals("renewed", refresher.refresh())
        // The second call has nothing stale to compare against, so it does
        // refresh — collapsing is about simultaneity, not about caching.
        assertEquals("renewed", refresher.refresh())
        assertEquals(2, refreshes.get())
    }

    @Test
    @DisplayName("a session that cannot be renewed reports null rather than throwing")
    fun deadSessionReturnsNull() = runTest {
        var token: String? = "expired"
        val refresher = CollapsingTokenRefresher(
            readToken = { token },
            performRefresh = {
                token = null
                throw IllegalStateException("refresh_token_not_found")
            },
        )

        assertNull(refresher.refresh())
    }

    @Test
    @DisplayName("an offline refresh leaves the old token in place and reports it")
    fun offlineRefreshKeepsWhatWasThere() = runTest {
        val token: String? = "expired"
        val refresher = CollapsingTokenRefresher(
            readToken = { token },
            performRefresh = { throw java.io.IOException("unable to resolve host") },
        )

        // Not null: the token is stale rather than gone, and the caller can
        // decide whether presenting it is worth a second 401. Signing the user
        // out because a tunnel ate one request would be the wrong answer.
        assertEquals("expired", refresher.refresh())
    }

    private companion object {
        const val REFRESH_MILLIS = 50L
        const val FOUR_REQUESTS = 4
    }
}
