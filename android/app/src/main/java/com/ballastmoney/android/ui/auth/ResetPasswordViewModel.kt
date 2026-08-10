package com.ballastmoney.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.data.auth.AuthCallbackLink
import com.ballastmoney.android.data.auth.AuthOutcome
import com.ballastmoney.android.data.auth.AuthRepository
import com.ballastmoney.android.data.auth.SupabaseClientProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Sets a new password using the credentials carried by a recovery link.
 *
 * The link arrives from the screen rather than from a `SavedStateHandle`. It is
 * read out of the launching intent, which the composition already has a handle
 * on, and it is short-lived by design — putting a live access token through
 * navigation arguments would write it into the saved-instance-state bundle,
 * where it would outlive the screen on disk.
 */
@HiltViewModel
class ResetPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    clientProvider: SupabaseClientProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        ResetPasswordUiState(configurationProblem = clientProvider.configurationProblem),
    )
    val uiState: StateFlow<ResetPasswordUiState> = _uiState.asStateFlow()

    private var link: AuthCallbackLink? = null

    /** Called once, when the screen learns which link opened it. */
    fun onLinkReceived(received: AuthCallbackLink?) {
        link = received
        _uiState.update {
            it.copy(
                hasLink = received?.hasCredentials == true,
                linkProblem = received?.errorDescription,
            )
        }
    }

    fun onPasswordChange(value: String) {
        _uiState.update {
            it.copy(
                password = value,
                passwordError = null,
                confirmPasswordError = null,
                formError = null,
            )
        }
    }

    fun onConfirmPasswordChange(value: String) {
        _uiState.update {
            it.copy(confirmPassword = value, confirmPasswordError = null, formError = null)
        }
    }

    fun updatePassword() {
        val current = _uiState.value
        val recovery = link
        if (!current.canSubmit || recovery == null) return

        val passwordError = AuthValidation.newPassword(current.password)
        val confirmError = AuthValidation.confirmation(current.password, current.confirmPassword)
        if (passwordError != null || confirmError != null) {
            _uiState.update {
                it.copy(
                    passwordError = passwordError,
                    confirmPasswordError = confirmError,
                    formError = null,
                )
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, formError = null) }
            val outcome = authRepository.completePasswordReset(
                link = recovery,
                newPassword = current.password,
            )
            _uiState.update { state ->
                when (outcome) {
                    // Success signs the user in, so the shell replaces this
                    // screen; clearing the fields is for the frame in between.
                    AuthOutcome.Success -> state.copy(
                        isSubmitting = false,
                        password = "",
                        confirmPassword = "",
                    )

                    AuthOutcome.Cancelled -> state.copy(isSubmitting = false)

                    is AuthOutcome.Failure ->
                        state.copy(isSubmitting = false, formError = outcome.message)
                }
            }
        }
    }
}
