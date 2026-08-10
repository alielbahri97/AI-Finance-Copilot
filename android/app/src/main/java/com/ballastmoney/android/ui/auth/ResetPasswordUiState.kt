package com.ballastmoney.android.ui.auth

/**
 * Choosing a new password after opening a recovery link.
 *
 * [hasLink] is what separates "the user got here from their email" from "the
 * user got here some other way". Without a link there is nothing to
 * authenticate the change with, so the form is not shown at all — an enabled
 * form that can only ever fail is worse than an explanation.
 *
 * [linkProblem] carries the reason Supabase put in the URL when the link itself
 * is the problem, which is usually that it has expired or has already been
 * used.
 */
data class ResetPasswordUiState(
    val password: String = "",
    val confirmPassword: String = "",
    val passwordError: String? = null,
    val confirmPasswordError: String? = null,
    val formError: String? = null,
    val isSubmitting: Boolean = false,
    val hasLink: Boolean = false,
    val linkProblem: String? = null,
    val configurationProblem: String? = null,
) {
    val canSubmit: Boolean
        get() = !isSubmitting && hasLink && configurationProblem == null
}
