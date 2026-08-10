package com.ballastmoney.android.testing

import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionLockStore
import com.ballastmoney.android.core.domain.ThemePreference
import com.ballastmoney.android.core.domain.UserPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * In-memory stand-ins for the two DataStore-backed interfaces.
 *
 * The real implementation is a thin mapping over DataStore, which needs a file
 * and a scope; testing the timing rules through it would mean testing DataStore.
 */
class InMemoryPreferencesRepository(
    initial: UserPreferences = UserPreferences(),
) : PreferencesRepository {

    private val state = MutableStateFlow(initial)

    override val preferences: Flow<UserPreferences> = state.asStateFlow()

    val current: UserPreferences get() = state.value

    override suspend fun setTheme(theme: ThemePreference) {
        state.update { it.copy(theme = theme) }
    }

    override suspend fun setSessionLockSeconds(seconds: Int) {
        state.update { it.copy(sessionLockSeconds = seconds) }
    }

    override suspend fun setBiometricUnlockEnabled(enabled: Boolean) {
        state.update { it.copy(biometricUnlockEnabled = enabled) }
    }

    override suspend fun setSelectedWorkspaceId(workspaceId: String?) {
        state.update { it.copy(selectedWorkspaceId = workspaceId) }
    }
}

class InMemorySessionLockStore(
    locked: Boolean = false,
    backgroundedAt: Long? = null,
) : SessionLockStore {

    private data class State(val locked: Boolean, val backgroundedAt: Long?)

    private val state = MutableStateFlow(State(locked, backgroundedAt))

    override val isLocked: Flow<Boolean> = state.map { it.locked }

    override suspend fun setLocked(locked: Boolean) {
        state.update { it.copy(locked = locked) }
    }

    override suspend fun recordBackgrounded(elapsedRealtimeMs: Long) {
        state.update { it.copy(backgroundedAt = elapsedRealtimeMs) }
    }

    override suspend fun backgroundedAt(): Long? = state.value.backgroundedAt

    override suspend fun clearBackgrounded() {
        state.update { it.copy(backgroundedAt = null) }
    }

    val lockedNow: Boolean get() = state.value.locked
    val backgroundedAtNow: Long? get() = state.value.backgroundedAt
}
