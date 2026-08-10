package com.ballastmoney.android.ui.auth

/**
 * The reset-request form, and the "check your inbox" notice that replaces it.
 *
 * [isSent] is a boolean rather than the address, unlike sign-up, precisely
 * because the notice must not name it: repeating the address back would turn a
 * deliberately vague answer into a confirmation that the account exists.
 */
data class ForgotPasswordUiState(
    val email: String = "",
    val emailError: String? = null,
    val formError: String? = null,
    val isSubmitting: Boolean = false,
    val isSent: Boolean = false,
    val configurationProblem: String? = null,
) {
    val canSubmit: Boolean
        get() = !isSubmitting && configurationProblem == null
}
