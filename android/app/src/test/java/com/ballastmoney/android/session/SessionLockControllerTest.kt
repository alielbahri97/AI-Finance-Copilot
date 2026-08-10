package com.ballastmoney.android.session

import app.cash.turbine.test
import com.ballastmoney.android.core.domain.UserPreferences
import com.ballastmoney.android.testing.InMemoryPreferencesRepository
import com.ballastmoney.android.testing.InMemorySessionLockStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

@OptIn(ExperimentalCoroutinesApi::class)
class SessionLockControllerTest {

    private fun controller(
        store: InMemorySessionLockStore,
        preferences: InMemoryPreferencesRepository,
        scope: TestScope,
    ) = SessionLockController(store, preferences, scope)

    @ParameterizedTest(name = "away {0} ms with a {1} s threshold locks: {2}")
    @CsvSource(
        "0, 45, false",
        "44999, 45, false",
        "45000, 45, true",
        "45001, 45, true",
        "31000, 30, true",
        // elapsedRealtime going backwards can only mean a reboot.
        "-1, 45, true",
        "-500000, 45, true",
    )
    fun thresholdBoundaries(awayMs: Long, thresholdSeconds: Int, expected: Boolean) {
        assertTrue(
            SessionLockController.shouldLock(awayMs, thresholdSeconds) == expected,
            "away=$awayMs threshold=$thresholdSeconds",
        )
    }

    @Test
    @DisplayName("a short trip to another app does not lock")
    fun shortAbsenceStaysUnlocked() = runTest {
        val store = InMemorySessionLockStore()
        val preferences = InMemoryPreferencesRepository()
        val controller = controller(store, preferences, this)

        controller.onEnteredBackground(nowElapsedRealtimeMs = 10_000)
        controller.onEnteredForeground(nowElapsedRealtimeMs = 18_000)

        assertFalse(store.lockedNow)
        // Cleared, so the next return is measured from the next departure rather
        // than accumulating against a stale timestamp.
        assertNull(store.backgroundedAtNow)
    }

    @Test
    @DisplayName("crossing the threshold locks, and the flow reports it")
    fun longAbsenceLocks() = runTest {
        val store = InMemorySessionLockStore()
        val preferences = InMemoryPreferencesRepository()
        val controller = controller(store, preferences, this)

        controller.isLocked.test {
            assertFalse(awaitItem())

            controller.onEnteredBackground(nowElapsedRealtimeMs = 10_000)
            controller.onEnteredForeground(nowElapsedRealtimeMs = 10_000 + 60_000)

            assertTrue(awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    @DisplayName("the user's threshold is honoured, not the default")
    fun usesConfiguredThreshold() = runTest {
        val store = InMemorySessionLockStore()
        val preferences = InMemoryPreferencesRepository(
            UserPreferences(sessionLockSeconds = 300),
        )
        val controller = controller(store, preferences, this)

        controller.onEnteredBackground(nowElapsedRealtimeMs = 0)
        controller.onEnteredForeground(nowElapsedRealtimeMs = 120_000)

        assertFalse(store.lockedNow, "two minutes is inside a five-minute threshold")
    }

    @Test
    @DisplayName("a cold start with nothing recorded leaves the stored flag alone")
    fun coldStartKeepsStoredFlag() = runTest {
        val store = InMemorySessionLockStore(locked = true, backgroundedAt = null)
        val preferences = InMemoryPreferencesRepository()
        val controller = controller(store, preferences, this)

        controller.onEnteredForeground(nowElapsedRealtimeMs = 5_000)

        assertTrue(store.lockedNow, "a lock that survived process death must not be cleared by a start")
    }

    @Test
    @DisplayName("a reboot while backgrounded locks even though the clock reads lower")
    fun rebootLocks() = runTest {
        val store = InMemorySessionLockStore()
        val preferences = InMemoryPreferencesRepository()
        val controller = controller(store, preferences, this)

        controller.onEnteredBackground(nowElapsedRealtimeMs = 900_000)
        // After a reboot elapsedRealtime restarts near zero.
        controller.onEnteredForeground(nowElapsedRealtimeMs = 4_000)

        assertTrue(store.lockedNow)
    }

    @Test
    @DisplayName("unlocking clears both the flag and the recorded departure")
    fun unlockClearsEverything() = runTest {
        val store = InMemorySessionLockStore(locked = true, backgroundedAt = 1_000)
        val preferences = InMemoryPreferencesRepository()
        val controller = controller(store, preferences, this)

        controller.unlock()

        assertFalse(store.lockedNow)
        assertNull(store.backgroundedAtNow)
    }
}
