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

/**
 * Sign-in.
 *
 * There is no `onSuccess` callback and no navigation here. A successful sign-in
 * changes [com.ballastmoney.android.core.domain.AuthStateSource.isSignedIn],
 * the shell is collecting that, and the shell swaps the sign-in graph for the
 * app. Routing from here as well would be a second source of truth for the same
 * fact, and the two would disagree the moment a session is restored from disk
 * rather than typed in.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    clientProvider: SupabaseClientProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        LoginUiState(configurationProblem = clientProvider.configurationProblem),
    )
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    /**
     * Clears the field error as soon as the user edits the field.
     *
     * Leaving "Enter a valid email address" under an address the user is
     * currently correcting is the kind of small dishonesty that makes a form
     * feel hostile. The message comes back on the next submit if it is still
     * true.
     */
    fun onEmailChange(value: String) {
        _uiState.update { it.copy(email = value, emailError = null, formError = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, passwordError = null, formError = null) }
    }

    fun signIn() {
        val current = _uiState.value
        if (!current.canSubmit) return

        val emailError = AuthValidation.email(current.email)
        val passwordError = AuthValidation.signInPassword(current.password)
        if (emailError != null || passwordError != null) {
            _uiState.update {
                it.copy(emailError = emailError, passwordError = passwordError, formError = null)
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, formError = null) }
            val outcome = authRepository.signIn(
                emailAddress = current.email,
                rawPassword = current.password,
            )
            _uiState.update { state ->
                when (outcome) {
                    // The shell is about to replace this screen, so there is
                    // nothing to show; the spinner stops in case it does not,
                    // which happens when confirmation is still pending.
                    AuthOutcome.Success -> state.copy(isSubmitting = false, password = "")
                    AuthOutcome.Cancelled -> state.copy(isSubmitting = false)
                    is AuthOutcome.Failure ->
                        state.copy(isSubmitting = false, formError = outcome.message)
                }
            }
        }
    }
}
