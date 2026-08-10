package com.ballastmoney.android.ui.auth

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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

/**
 * Request a password reset email.
 *
 * The success notice is the same whether or not the address has an account, and
 * says so obliquely — see [AuthCopy.FORGOT_SENT_BODY].
 */
@Composable
fun ForgotPasswordScreen(
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ForgotPasswordViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ForgotPasswordContent(
        state = state,
        onEmailChange = viewModel::onEmailChange,
        onSubmit = viewModel::sendResetLink,
        onEditAddress = viewModel::editAddress,
        onNavigateToLogin = onNavigateToLogin,
        modifier = modifier,
    )
}

@Composable
fun ForgotPasswordContent(
    state: ForgotPasswordUiState,
    onEmailChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onEditAddress: () -> Unit,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthScaffold(
        title = if (state.isSent) AuthCopy.FORGOT_SENT_TITLE else AuthCopy.FORGOT_TITLE,
        modifier = modifier,
        subtitle = if (state.isSent) null else AuthCopy.FORGOT_SUBTITLE,
        footer = {
            BallastButton(
                text = AuthCopy.BACK_TO_SIGN_IN,
                onClick = onNavigateToLogin,
                variant = ButtonVariant.GHOST,
                size = ButtonSize.SMALL,
            )
        },
    ) {
        if (state.isSent) {
            BallastAlert(
                title = AuthCopy.FORGOT_SENT_TITLE,
                description = AuthCopy.FORGOT_SENT_BODY,
                icon = Icons.Outlined.MarkEmailRead,
            )
            BallastButton(
                text = AuthCopy.WRONG_ADDRESS,
                onClick = onEditAddress,
                variant = ButtonVariant.GHOST,
                size = ButtonSize.SMALL,
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
                imeAction = ImeAction.Done,
            ),
        )

        val formError = state.formError
        if (formError != null) {
            AuthErrorAlert(title = AuthCopy.FORGOT_ERROR_TITLE, message = formError)
        }

        BallastButton(
            text = AuthCopy.FORGOT_SUBMIT,
            onClick = onSubmit,
            enabled = state.canSubmit,
            loading = state.isSubmitting,
            fillMaxWidth = true,
        )
    }
}
