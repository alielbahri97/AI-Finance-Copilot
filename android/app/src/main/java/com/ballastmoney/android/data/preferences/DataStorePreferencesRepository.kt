package com.ballastmoney.android.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionLockStore
import com.ballastmoney.android.core.domain.ThemePreference
import com.ballastmoney.android.core.domain.UserPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DataStorePreferencesRepository @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) : PreferencesRepository, SessionLockStore {

    override val preferences: Flow<UserPreferences> = dataStore.data.map { prefs ->
        UserPreferences(
            theme = prefs[Keys.THEME]
                ?.let { stored -> ThemePreference.entries.firstOrNull { it.name == stored } }
                ?: ThemePreference.SYSTEM,
            sessionLockSeconds = prefs[Keys.LOCK_SECONDS]
                ?: UserPreferences.DEFAULT_SESSION_LOCK_SECONDS,
            biometricUnlockEnabled = prefs[Keys.BIOMETRIC_UNLOCK] ?: true,
            selectedWorkspaceId = prefs[Keys.SELECTED_WORKSPACE],
        )
    }

    override suspend fun setTheme(theme: ThemePreference) {
        dataStore.edit { it[Keys.THEME] = theme.name }
    }

    override suspend fun setSessionLockSeconds(seconds: Int) {
        dataStore.edit { it[Keys.LOCK_SECONDS] = seconds.coerceIn(5, 3_600) }
    }

    override suspend fun setBiometricUnlockEnabled(enabled: Boolean) {
        dataStore.edit { it[Keys.BIOMETRIC_UNLOCK] = enabled }
    }

    override suspend fun setSelectedWorkspaceId(workspaceId: String?) {
        dataStore.edit { prefs ->
            if (workspaceId == null) prefs.remove(Keys.SELECTED_WORKSPACE)
            else prefs[Keys.SELECTED_WORKSPACE] = workspaceId
        }
    }

    override val isLocked: Flow<Boolean> =
        dataStore.data.map { it[Keys.LOCKED] ?: false }

    override suspend fun setLocked(locked: Boolean) {
        dataStore.edit { it[Keys.LOCKED] = locked }
    }

    override suspend fun recordBackgrounded(elapsedRealtimeMs: Long) {
        dataStore.edit { it[Keys.BACKGROUNDED_AT] = elapsedRealtimeMs }
    }

    override suspend fun backgroundedAt(): Long? =
        dataStore.data.first()[Keys.BACKGROUNDED_AT]

    override suspend fun clearBackgrounded() {
        dataStore.edit { it.remove(Keys.BACKGROUNDED_AT) }
    }

    private object Keys {
        val THEME = stringPreferencesKey("theme")
        val LOCK_SECONDS = intPreferencesKey("session_lock_seconds")
        val BIOMETRIC_UNLOCK = booleanPreferencesKey("biometric_unlock_enabled")
        val SELECTED_WORKSPACE = stringPreferencesKey("selected_workspace_id")
        val LOCKED = booleanPreferencesKey("session_locked")
        val BACKGROUNDED_AT = longPreferencesKey("backgrounded_at_elapsed_realtime")
    }
}
