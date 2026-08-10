package com.ballastmoney.android.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.BuildConfig
import com.ballastmoney.android.core.domain.PreferencesRepository
import com.ballastmoney.android.core.domain.SessionRepository
import com.ballastmoney.android.core.domain.ThemePreference
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.session.SessionLockController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * What the app shell needs regardless of which screen is showing: who is signed
 * in, which workspace and edition they are in, whether the app is locked, and
 * which theme to use.
 *
 * The session is held here rather than fetched per screen because the bottom bar
 * and drawer are built from the permission set, and a screen-scoped copy would
 * let the chrome and the content disagree during a workspace switch.
 */
data class RootUiState(
    val isLoading: Boolean = true,
    val session: SessionBootstrap? = null,
    val errorMessage: String? = null,
    val theme: ThemePreference = ThemePreference.SYSTEM,
    val isLocked: Boolean = false,
    val sessionLockSeconds: Int = 45,
    val biometricUnlockEnabled: Boolean = true,
    /**
     * True while the app is reading the in-memory fixtures instead of the API.
     * Surfaced in the UI on purpose: a screen full of convincing but invented
     * balances should say so.
     */
    val usingSampleData: Boolean = BuildConfig.USE_FAKE_DATA,
) {
    val isSignedIn: Boolean get() = session != null
}

@HiltViewModel
class RootViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val preferencesRepository: PreferencesRepository,
    private val sessionLockController: SessionLockController,
) : ViewModel() {

    private val isLoading = MutableStateFlow(true)
    private val errorMessage = MutableStateFlow<String?>(null)

    val uiState: StateFlow<RootUiState> = combine(
        sessionRepository.session,
        preferencesRepository.preferences,
        sessionLockController.isLocked,
        isLoading,
        errorMessage,
    ) { session, preferences, locked, loading, error ->
        RootUiState(
            isLoading = loading && session == null,
            session = session,
            errorMessage = error.takeIf { session == null },
            theme = preferences.theme,
            isLocked = locked,
            sessionLockSeconds = preferences.sessionLockSeconds,
            biometricUnlockEnabled = preferences.biometricUnlockEnabled,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = RootUiState(),
    )

    init {
        bootstrap()
    }

    private fun bootstrap() {
        viewModelScope.launch {
            isLoading.value = true
            errorMessage.value = null
            // Restore the workspace the user last chose before the first fetch,
            // so a Personal user does not see the Business dashboard flash by.
            val remembered = preferencesRepository.preferences.first().selectedWorkspaceId
            val result = if (remembered != null) {
                sessionRepository.selectWorkspace(remembered)
            } else {
                sessionRepository.refresh()
            }
            result.onFailure { error ->
                errorMessage.value = error.message?.takeIf { it.isNotBlank() }
                    ?: "We could not load your account. Check your connection and try again."
            }
            isLoading.value = false
        }
    }

    fun retry() = bootstrap()

    fun selectWorkspace(workspaceId: String) {
        viewModelScope.launch {
            preferencesRepository.setSelectedWorkspaceId(workspaceId)
            sessionRepository.selectWorkspace(workspaceId).onFailure { error ->
                errorMessage.value = error.message
            }
        }
    }

    fun setTheme(theme: ThemePreference) {
        viewModelScope.launch { preferencesRepository.setTheme(theme) }
    }

    fun unlock() {
        viewModelScope.launch { sessionLockController.unlock() }
    }

    fun lockNow() {
        viewModelScope.launch { sessionLockController.lockNow() }
    }

    fun signOut() {
        viewModelScope.launch {
            sessionRepository.signOut()
            preferencesRepository.setSelectedWorkspaceId(null)
            sessionLockController.unlock()
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
