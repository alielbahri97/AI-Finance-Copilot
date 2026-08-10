package com.ballastmoney.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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

/** Asks Supabase to email a recovery link pointing at `ballast://auth/reset-password`. */
@HiltViewModel
class ForgotPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    clientProvider: SupabaseClientProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        ForgotPasswordUiState(configurationProblem = clientProvider.configurationProblem),
    )
    val uiState: StateFlow<ForgotPasswordUiState> = _uiState.asStateFlow()

    fun onEmailChange(value: String) {
        _uiState.update { it.copy(email = value, emailError = null, formError = null) }
    }

    /** Back to the form, for someone who spotted the typo after sending. */
    fun editAddress() {
        _uiState.update { it.copy(isSent = false) }
    }

    fun sendResetLink() {
        val current = _uiState.value
        if (!current.canSubmit) return

        val emailError = AuthValidation.email(current.email)
        if (emailError != null) {
            _uiState.update { it.copy(emailError = emailError, formError = null) }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, formError = null) }
            val outcome = authRepository.sendPasswordResetEmail(current.email)
            _uiState.update { state ->
                when (outcome) {
                    AuthOutcome.Success -> state.copy(isSubmitting = false, isSent = true)
                    AuthOutcome.Cancelled -> state.copy(isSubmitting = false)
                    is AuthOutcome.Failure ->
                        state.copy(isSubmitting = false, formError = outcome.message)
                }
            }
        }
    }
}
