package com.ballastmoney.android.ui.auth

import com.ballastmoney.android.core.model.WorkspaceType

/**
 * The sign-up form, and the confirmation notice that replaces it.
 *
 * [submittedEmail] is what switches between the two. It is the address the
 * account was created with rather than a boolean, because the notice names it
 * — "we sent a link to a@b.com" is checkable by the reader; "check your inbox"
 * is not, and half of failed sign-ups are a typo in the address.
 *
 * The default edition is [WorkspaceType.BUSINESS], matching
 * `DEFAULT_WORKSPACE_TYPE` in `src/lib/workspace/editions.ts`, so a workspace
 * created from the phone lands in the same edition as one created from a
 * `/signup` link with no `?for=` on it.
 */
data class SignupUiState(
    val fullName: String = "",
    val email: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val referralCode: String = "",
    val edition: WorkspaceType = WorkspaceType.BUSINESS,
    val fullNameError: String? = null,
    val emailError: String? = null,
    val passwordError: String? = null,
    val confirmPasswordError: String? = null,
    val formError: String? = null,
    val isSubmitting: Boolean = false,
    val submittedEmail: String? = null,
    val isResending: Boolean = false,
    /** Counts down from [AuthCopy.RESEND_COOLDOWN_SECONDS] after each send. */
    val resendCooldownSeconds: Int = 0,
    val resendMessage: String? = null,
    val configurationProblem: String? = null,
) {
    val canSubmit: Boolean
        get() = !isSubmitting && configurationProblem == null

    val canResend: Boolean
        get() = !isResending && resendCooldownSeconds <= 0
}
