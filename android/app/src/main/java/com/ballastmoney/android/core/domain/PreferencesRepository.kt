package com.ballastmoney.android.core.domain

import kotlinx.coroutines.flow.Flow

enum class ThemePreference {
    SYSTEM,
    LIGHT,
    DARK,
}

data class UserPreferences(
    val theme: ThemePreference = ThemePreference.SYSTEM,
    /**
     * How long the app may sit in the background before it locks.
     *
     * The web app uses ten seconds, which is right for a browser tab you can
     * glance away from and back to. On a phone it is hostile: reading a
     * verification code in another app takes longer than that. The default here
     * is 45 seconds and the user can change it.
     */
    val sessionLockSeconds: Int = DEFAULT_SESSION_LOCK_SECONDS,
    val biometricUnlockEnabled: Boolean = true,
    val selectedWorkspaceId: String? = null,
) {
    companion object {
        const val DEFAULT_SESSION_LOCK_SECONDS = 45
        val SESSION_LOCK_OPTIONS = listOf(30, 45, 60, 120, 300)
    }
}

interface PreferencesRepository {
    val preferences: Flow<UserPreferences>

    suspend fun setTheme(theme: ThemePreference)

    suspend fun setSessionLockSeconds(seconds: Int)

    suspend fun setBiometricUnlockEnabled(enabled: Boolean)

    suspend fun setSelectedWorkspaceId(workspaceId: String?)
}

/**
 * Persistence for the lock itself, kept separate from user preferences because
 * it is machine state rather than a setting.
 *
 * Times are [android.os.SystemClock.elapsedRealtime] values, not wall-clock
 * ones. Wall-clock time is attacker-controlled — someone who picks up an
 * unlocked-looking phone could wind the system clock back and defeat a
 * timestamp comparison. elapsedRealtime counts since boot and cannot be set.
 *
 * The trade-off is that elapsedRealtime resets on reboot, so a stored value
 * that is *ahead* of the current reading means the device rebooted, which is
 * treated as "lock" rather than "unlock".
 */
interface SessionLockStore {
    /** Survives process death, which is the whole point of persisting it. */
    val isLocked: Flow<Boolean>

    suspend fun setLocked(locked: Boolean)

    suspend fun recordBackgrounded(elapsedRealtimeMs: Long)

    suspend fun backgroundedAt(): Long?

    suspend fun clearBackgrounded()
}
