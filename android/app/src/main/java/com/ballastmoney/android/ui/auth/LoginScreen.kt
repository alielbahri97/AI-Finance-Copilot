package com.ballastmoney.android.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastTextField
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Sign in with an email address and a password.
 *
 * The stateful wrapper does nothing but subscribe and forward, so
 * [LoginContent] can be rendered from a preview or a UI test with no Hilt
 * graph, no Supabase project and no network — the same split every screen
 * package in this app uses.
 *
 * There is no passkey button. `PasskeySupport.ENABLED` is false and the
 * ceremony is not implemented, and a control that always fails is worse than no
 * control; the failure copy is nevertheless written and tested in
 * `AuthErrorMapper` so turning it on later is not also a copy exercise.
 */
@Composable
fun LoginScreen(
    onNavigateToSignup: () -> Unit,
    onNavigateToForgotPassword: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LoginContent(
        state = state,
        onEmailChange = viewModel::onEmailChange,
        onPasswordChange = viewModel::onPasswordChange,
        onSubmit = viewModel::signIn,
        onNavigateToSignup = onNavigateToSignup,
        onNavigateToForgotPassword = onNavigateToForgotPassword,
        modifier = modifier,
    )
}

@Composable
fun LoginContent(
    state: LoginUiState,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onNavigateToSignup: () -> Unit,
    onNavigateToForgotPassword: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        title = AuthCopy.LOGIN_TITLE,
        modifier = modifier,
        subtitle = AuthCopy.LOGIN_SUBTITLE,
        footer = {
            AuthFooterPrompt(
                prompt = AuthCopy.NO_ACCOUNT,
                actionText = AuthCopy.CREATE_ONE,
                onAction = onNavigateToSignup,
            )
        },
    ) {
        val problem = state.configurationProblem
        if (problem != null) {
            BallastAlert(
                title = AuthCopy.NOT_CONFIGURED_TITLE,
                description = problem,
                variant = AlertVariant.WARNING,
                icon = Icons.Filled.Warning,
            )
        }

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

        Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs)) {
            AuthPasswordField(
                value = state.password,
                onValueChange = onPasswordChange,
                label = AuthCopy.PASSWORD_LABEL,
                errorMessage = state.passwordError,
                enabled = state.canSubmit,
                imeAction = ImeAction.Done,
                onImeAction = onSubmit,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BallastButton(
                    text = AuthCopy.FORGOT_PASSWORD_LINK,
                    onClick = onNavigateToForgotPassword,
                    variant = ButtonVariant.LINK,
                    size = ButtonSize.SMALL,
                )
            }
        }

        val formError = state.formError
        if (formError != null) {
            AuthErrorAlert(title = AuthCopy.LOGIN_ERROR_TITLE, message = formError)
        }

        BallastButton(
            text = AuthCopy.LOGIN_SUBMIT,
            onClick = onSubmit,
            enabled = state.canSubmit,
            loading = state.isSubmitting,
            fillMaxWidth = true,
        )

        // Keeps the "Ballast is a workspace, not a bank" expectation honest on
        // the very first screen someone sees.
        Text(
            text = "Ballast never sees your bank credentials. Connections are made through " +
                "your bank's own consent screen.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }
}
