package com.ballastmoney.android.ui.auth

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.data.auth.AuthCallbackLink
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant

/**
 * The last step of a password reset.
 *
 * [link] is the parsed `ballast://auth/reset-password` callback, or null when
 * the screen was reached without one. It is handed to the ViewModel in a
 * [LaunchedEffect] keyed on the link, so a second link arriving in the same
 * composition replaces the first rather than being ignored.
 */
@Composable
fun ResetPasswordScreen(
    link: AuthCallbackLink?,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ResetPasswordViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(link) { viewModel.onLinkReceived(link) }

    ResetPasswordContent(
        state = state,
        onPasswordChange = viewModel::onPasswordChange,
        onConfirmPasswordChange = viewModel::onConfirmPasswordChange,
        onSubmit = viewModel::updatePassword,
        onNavigateToLogin = onNavigateToLogin,
        modifier = modifier,
    )
}

@Composable
fun ResetPasswordContent(
    state: ResetPasswordUiState,
    onPasswordChange: (String) -> Unit,
    onConfirmPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        title = if (state.hasLink) AuthCopy.RESET_TITLE else AuthCopy.RESET_NO_LINK_TITLE,
        modifier = modifier,
        subtitle = if (state.hasLink) AuthCopy.RESET_SUBTITLE else null,
        footer = {
            BallastButton(
                text = AuthCopy.BACK_TO_SIGN_IN,
                onClick = onNavigateToLogin,
                variant = ButtonVariant.GHOST,
                size = ButtonSize.SMALL,
            )
        },
    ) {
        if (!state.hasLink) {
            BallastAlert(
                title = AuthCopy.RESET_NO_LINK_TITLE,
                // Supabase's own reason when it gave one — an expired or spent
                // link says so in the URL — and the general explanation
                // otherwise.
                description = state.linkProblem ?: AuthCopy.RESET_NO_LINK_BODY,
                variant = AlertVariant.WARNING,
                icon = Icons.Filled.Warning,
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

        AuthPasswordField(
            value = state.password,
            onValueChange = onPasswordChange,
            label = AuthCopy.NEW_PASSWORD_LABEL,
            errorMessage = state.passwordError,
            enabled = state.canSubmit,
        )

        AuthPasswordField(
            value = state.confirmPassword,
            onValueChange = onConfirmPasswordChange,
            label = AuthCopy.CONFIRM_NEW_PASSWORD_LABEL,
            errorMessage = state.confirmPasswordError,
            enabled = state.canSubmit,
            imeAction = ImeAction.Done,
            onImeAction = onSubmit,
        )

        val formError = state.formError
        if (formError != null) {
            AuthErrorAlert(title = AuthCopy.RESET_ERROR_TITLE, message = formError)
        }

        BallastButton(
            text = AuthCopy.RESET_SUBMIT,
            onClick = onSubmit,
            enabled = state.canSubmit,
            loading = state.isSubmitting,
            fillMaxWidth = true,
        )
    }
}
