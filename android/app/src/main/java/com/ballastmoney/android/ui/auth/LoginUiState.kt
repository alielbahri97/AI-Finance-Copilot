package com.ballastmoney.android.ui.auth

/**
 * Everything the sign-in screen renders.
 *
 * One data class rather than a sealed hierarchy: unlike the dashboard, this
 * screen has no loading or error *variant* — the form is always on screen and
 * the failure sits above the button. Modelling it as states would mean
 * reconstructing the half-typed email on the way back out of the error state.
 *
 * [configurationProblem] is separate from [formError] because it is not
 * something the user did. It is present from the first frame, it names a file
 * the developer has to create, and it disables the form rather than appearing
 * after a failed attempt.
 */
data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val emailError: String? = null,
    val passwordError: String? = null,
    val formError: String? = null,
    val isSubmitting: Boolean = false,
    val configurationProblem: String? = null,
) {
    /** False while a request is in flight, or when the build cannot sign in at all. */
    val canSubmit: Boolean
        get() = !isSubmitting && configurationProblem == null
}
