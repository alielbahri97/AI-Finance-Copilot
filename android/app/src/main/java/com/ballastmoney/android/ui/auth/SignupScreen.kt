package com.ballastmoney.android.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastTextField
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Create an account.
 *
 * The edition choice is part of the form rather than something asked later.
 * `workspace_type` has to be in the Supabase user metadata at sign-up: it is
 * read by the server when the first workspace is created, which happens on the
 * back of the confirmation link, by which point this app is not running and has
 * nothing left to send. Asking afterwards would mean the workspace already
 * exists in the wrong edition.
 */
@Composable
fun SignupScreen(
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SignupViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    SignupContent(
        state = state,
        onFullNameChange = viewModel::onFullNameChange,
        onEmailChange = viewModel::onEmailChange,
        onPasswordChange = viewModel::onPasswordChange,
        onConfirmPasswordChange = viewModel::onConfirmPasswordChange,
        onReferralCodeChange = viewModel::onReferralCodeChange,
        onEditionChange = viewModel::onEditionChange,
        onSubmit = viewModel::signUp,
        onResend = viewModel::resendConfirmation,
        onEditAddress = viewModel::editAddress,
        onNavigateToLogin = onNavigateToLogin,
        modifier = modifier,
    )
}

@Composable
fun SignupContent(
    state: SignupUiState,
    onFullNameChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onConfirmPasswordChange: (String) -> Unit,
    onReferralCodeChange: (String) -> Unit,
    onEditionChange: (WorkspaceType) -> Unit,
    onSubmit: () -> Unit,
    onResend: () -> Unit,
    onEditAddress: () -> Unit,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val submittedEmail = state.submittedEmail
    AuthScaffold(
        title = if (submittedEmail == null) {
            AuthCopy.SIGNUP_TITLE
        } else {
            AuthCopy.CONFIRM_EMAIL_TITLE
        },
        modifier = modifier,
        subtitle = if (submittedEmail == null) {
            AuthCopy.editionChoiceDescription(state.edition)
        } else {
            null
        },
        eyebrow = if (submittedEmail == null) AuthCopy.editionName(state.edition) else null,
        footer = {
            AuthFooterPrompt(
                prompt = AuthCopy.HAVE_ACCOUNT,
                actionText = AuthCopy.SIGN_IN,
                onAction = onNavigateToLogin,
            )
        },
    ) {
        if (submittedEmail != null) {
            ConfirmEmailNotice(
                email = submittedEmail,
                isResending = state.isResending,
                canResend = state.canResend,
                cooldownSeconds = state.resendCooldownSeconds,
                resendMessage = state.resendMessage,
                onResend = onResend,
                onEditAddress = onEditAddress,
            )
            return@AuthScaffold
        }

        val problem = state.configurationProblem
        if (problem != null) {
            BallastAlert(
                title = AuthCopy.NOT_CONFIGURED_TITLE,
                description = problem,
                variant = AlertVariant.WARNING,
                icon = Icons.Filled.Warning,
            )
        }

        EditionChoice(
            selected = state.edition,
            onSelect = onEditionChange,
            enabled = state.canSubmit,
        )

        BallastTextField(
            value = state.fullName,
            onValueChange = onFullNameChange,
            label = AuthCopy.FULL_NAME_LABEL,
            placeholder = AuthCopy.FULL_NAME_PLACEHOLDER,
            supportingText = state.fullNameError,
            isError = state.fullNameError != null,
            enabled = state.canSubmit,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Next,
            ),
        )

        BallastTextField(
            value = state.email,
            onValueChange = onEmailChange,
            label = AuthCopy.EMAIL_LABEL,
            placeholder = AuthCopy.EMAIL_PLACEHOLDER,
            supportingText = state.emailError,
            isError = state.emailError != null,
            enabled = state.canSubmit,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
        )

        AuthPasswordField(
            value = state.password,
            onValueChange = onPasswordChange,
            label = AuthCopy.PASSWORD_LABEL,
            errorMessage = state.passwordError,
            enabled = state.canSubmit,
        )

        AuthPasswordField(
            value = state.confirmPassword,
            onValueChange = onConfirmPasswordChange,
            label = AuthCopy.CONFIRM_PASSWORD_LABEL,
            errorMessage = state.confirmPasswordError,
            enabled = state.canSubmit,
            imeAction = ImeAction.Done,
            onImeAction = onSubmit,
        )

        BallastTextField(
            value = state.referralCode,
            onValueChange = onReferralCodeChange,
            label = AuthCopy.REFERRAL_LABEL,
            placeholder = AuthCopy.REFERRAL_PLACEHOLDER,
            enabled = state.canSubmit,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Done,
            ),
        )

        val formError = state.formError
        if (formError != null) {
            AuthErrorAlert(title = AuthCopy.SIGNUP_ERROR_TITLE, message = formError)
        }

        BallastButton(
            text = AuthCopy.SIGNUP_SUBMIT,
            onClick = onSubmit,
            enabled = state.canSubmit,
            loading = state.isSubmitting,
            fillMaxWidth = true,
        )
    }
}

/**
 * What replaces the form once the account exists.
 *
 * Both follow-up actions are here rather than the user being sent back to sign
 * in: a confirmation email that has not arrived is the single most common place
 * a sign-up stalls, and the two things that fix it are sending it again and
 * correcting the address.
 *
 * It emits several siblings and takes no modifier, because it is only ever
 * called from the [AuthScaffold] content slot and inherits that column's
 * spacing rather than imposing its own.
 */
@Composable
private fun ConfirmEmailNotice(
    email: String,
    isResending: Boolean,
    canResend: Boolean,
    cooldownSeconds: Int,
    resendMessage: String?,
    onResend: () -> Unit,
    onEditAddress: () -> Unit,
) {
    BallastAlert(
        title = AuthCopy.CONFIRM_EMAIL_TITLE,
        description = AuthCopy.confirmEmailBody(email),
        icon = Icons.Outlined.MarkEmailRead,
    )

    Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
        BallastButton(
            text = if (cooldownSeconds > 0) {
                AuthCopy.resendIn(cooldownSeconds)
            } else {
                AuthCopy.RESEND_CONFIRMATION
            },
            onClick = onResend,
            variant = ButtonVariant.OUTLINE,
            size = ButtonSize.SMALL,
            enabled = canResend,
            loading = isResending,
        )
        BallastButton(
            text = AuthCopy.WRONG_ADDRESS,
            onClick = onEditAddress,
            variant = ButtonVariant.GHOST,
            size = ButtonSize.SMALL,
        )
    }

    if (resendMessage != null) {
        Text(
            text = resendMessage,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }

    Text(
        text = AuthCopy.SIGNUP_AGAIN_NOTE,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.ballastColors.mutedForeground,
    )
}
