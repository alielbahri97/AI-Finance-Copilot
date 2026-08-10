package com.ballastmoney.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.data.auth.AuthOutcome
import com.ballastmoney.android.data.auth.AuthRepository
import com.ballastmoney.android.data.auth.SupabaseClientProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Sign-up, including the edition choice that has to reach Supabase metadata.
 *
 * The screen ends on "confirm your email" whether or not the project requires
 * confirmation. With it on, that is the truth. With it off, Supabase signs the
 * new user straight in, the shell follows the session into the app, and the
 * notice is never seen. Branching on which happened would mean asking Supabase
 * a question whose answer changes nothing this screen does.
 */
@HiltViewModel
class SignupViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    clientProvider: SupabaseClientProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        SignupUiState(configurationProblem = clientProvider.configurationProblem),
    )
    val uiState: StateFlow<SignupUiState> = _uiState.asStateFlow()

    /**
     * Held so a second send restarts the countdown rather than racing the first
     * one to zero.
     */
    private var cooldownJob: Job? = null

    fun onFullNameChange(value: String) {
        _uiState.update { it.copy(fullName = value, fullNameError = null, formError = null) }
    }

    fun onEmailChange(value: String) {
        _uiState.update { it.copy(email = value, emailError = null, formError = null) }
    }

    fun onPasswordChange(value: String) {
        // The confirmation error is cleared too: it describes the pair, and the
        // pair has just changed.
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

    fun onReferralCodeChange(value: String) {
        _uiState.update { it.copy(referralCode = value, formError = null) }
    }

    fun onEditionChange(edition: WorkspaceType) {
        _uiState.update { it.copy(edition = edition) }
    }

    /** Back to the form from the confirmation notice, for a mistyped address. */
    fun editAddress() {
        cooldownJob?.cancel()
        _uiState.update {
            it.copy(submittedEmail = null, resendCooldownSeconds = 0, resendMessage = null)
        }
    }

    fun signUp() {
        val current = _uiState.value
        if (!current.canSubmit) return

        val fullNameError = AuthValidation.fullName(current.fullName)
        val emailError = AuthValidation.email(current.email)
        val passwordError = AuthValidation.newPassword(current.password)
        val confirmError = AuthValidation.confirmation(current.password, current.confirmPassword)
        if (fullNameError != null || emailError != null ||
            passwordError != null || confirmError != null
        ) {
            _uiState.update {
                it.copy(
                    fullNameError = fullNameError,
                    emailError = emailError,
                    passwordError = passwordError,
                    confirmPasswordError = confirmError,
                    formError = null,
                )
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, formError = null) }
            val outcome = authRepository.signUp(
                fullName = current.fullName,
                emailAddress = current.email,
                rawPassword = current.password,
                edition = current.edition,
                referralCode = current.referralCode,
            )
            when (outcome) {
                AuthOutcome.Success -> {
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            submittedEmail = it.email.trim(),
                            // Nothing keeps a password that has already been
                            // accepted.
                            password = "",
                            confirmPassword = "",
                        )
                    }
                    startCooldown()
                }

                AuthOutcome.Cancelled -> _uiState.update { it.copy(isSubmitting = false) }

                is AuthOutcome.Failure -> _uiState.update {
                    it.copy(isSubmitting = false, formError = outcome.message)
                }
            }
        }
    }

    fun resendConfirmation() {
        val current = _uiState.value
        val email = current.submittedEmail ?: return
        if (!current.canResend) return

        viewModelScope.launch {
            _uiState.update { it.copy(isResending = true, resendMessage = null) }
            val outcome = authRepository.resendConfirmationEmail(email)
            _uiState.update { state ->
                when (outcome) {
                    AuthOutcome.Success ->
                        state.copy(isResending = false, resendMessage = "Sent again to $email.")
                    AuthOutcome.Cancelled -> state.copy(isResending = false)
                    is AuthOutcome.Failure ->
                        state.copy(isResending = false, resendMessage = outcome.message)
                }
            }
            if (outcome is AuthOutcome.Success) startCooldown()
        }
    }

    /**
     * A visible countdown rather than a disabled button with no explanation.
     *
     * Supabase rate-limits confirmation emails to one a minute and answers a
     * second attempt with an error, so the choice is between showing the wait
     * and letting the user earn an error message by being impatient.
     */
    private fun startCooldown() {
        cooldownJob?.cancel()
        cooldownJob = viewModelScope.launch {
            _uiState.update { it.copy(resendCooldownSeconds = AuthCopy.RESEND_COOLDOWN_SECONDS) }
            while (_uiState.value.resendCooldownSeconds > 0) {
                delay(ONE_SECOND_MILLIS)
                _uiState.update { it.copy(resendCooldownSeconds = it.resendCooldownSeconds - 1) }
            }
        }
    }

    private companion object {
        const val ONE_SECOND_MILLIS = 1_000L
    }
}
