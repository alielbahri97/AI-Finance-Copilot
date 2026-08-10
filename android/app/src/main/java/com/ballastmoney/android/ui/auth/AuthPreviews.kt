package com.ballastmoney.android.ui.auth

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.theme.BallastTheme

// Previews for all four auth screens, driven by hand-built states.
//
// Every one of them renders the `*Content` composable rather than the `*Screen`
// wrapper, which is the point of that split: no Hilt graph, no Supabase project,
// no network. The failure and notice states are previewed as well as the happy
// path, because those are the ones nobody sees during development and therefore
// the ones that are wrong.

@Preview(name = "Login light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun LoginLightPreview() {
    BallastTheme(darkTheme = false) {
        LoginContent(
            state = LoginUiState(email = "ada@example.com", password = "hunter22"),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
            onNavigateToSignup = {},
            onNavigateToForgotPassword = {},
        )
    }
}

@Preview(name = "Login dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun LoginDarkPreview() {
    BallastTheme(darkTheme = true) {
        LoginContent(
            state = LoginUiState(email = "ada@example.com"),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
            onNavigateToSignup = {},
            onNavigateToForgotPassword = {},
        )
    }
}

@Preview(name = "Login rejected", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun LoginErrorPreview() {
    BallastTheme(darkTheme = false) {
        LoginContent(
            state = LoginUiState(
                email = "ada@example.com",
                password = "wrong",
                formError = "That email and password do not match an account. Check for " +
                    "typos, or reset your password below.",
            ),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
            onNavigateToSignup = {},
            onNavigateToForgotPassword = {},
        )
    }
}

/** What a checkout with no `secrets.properties` looks like. */
@Preview(name = "Login unconfigured", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun LoginUnconfiguredPreview() {
    BallastTheme(darkTheme = false) {
        LoginContent(
            state = LoginUiState(
                configurationProblem = "Ballast has no Supabase credentials, so signing in " +
                    "is not possible in this build. The supabase.url and supabase.anonKey " +
                    "values are empty.",
            ),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
            onNavigateToSignup = {},
            onNavigateToForgotPassword = {},
        )
    }
}

@Preview(name = "Signup light", showBackground = true, backgroundColor = 0xFFF8FAFD, heightDp = 1000)
@Composable
private fun SignupLightPreview() {
    BallastTheme(darkTheme = false) {
        SignupContent(
            state = SignupUiState(
                fullName = "Ada Lovelace",
                email = "ada@example.com",
                edition = WorkspaceType.PERSONAL,
            ),
            onFullNameChange = {},
            onEmailChange = {},
            onPasswordChange = {},
            onConfirmPasswordChange = {},
            onReferralCodeChange = {},
            onEditionChange = {},
            onSubmit = {},
            onResend = {},
            onEditAddress = {},
            onNavigateToLogin = {},
        )
    }
}

@Preview(name = "Signup confirm email", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun SignupConfirmPreview() {
    BallastTheme(darkTheme = false) {
        SignupContent(
            state = SignupUiState(
                submittedEmail = "ada@example.com",
                resendCooldownSeconds = 42,
            ),
            onFullNameChange = {},
            onEmailChange = {},
            onPasswordChange = {},
            onConfirmPasswordChange = {},
            onReferralCodeChange = {},
            onEditionChange = {},
            onSubmit = {},
            onResend = {},
            onEditAddress = {},
            onNavigateToLogin = {},
        )
    }
}

@Preview(name = "Forgot password", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ForgotPasswordPreview() {
    BallastTheme(darkTheme = false) {
        ForgotPasswordContent(
            state = ForgotPasswordUiState(email = "ada@example.com"),
            onEmailChange = {},
            onSubmit = {},
            onEditAddress = {},
            onNavigateToLogin = {},
        )
    }
}

@Preview(name = "Forgot password sent", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ForgotPasswordSentPreview() {
    BallastTheme(darkTheme = true) {
        ForgotPasswordContent(
            state = ForgotPasswordUiState(email = "ada@example.com", isSent = true),
            onEmailChange = {},
            onSubmit = {},
            onEditAddress = {},
            onNavigateToLogin = {},
        )
    }
}

@Preview(name = "Reset password", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ResetPasswordPreview() {
    BallastTheme(darkTheme = false) {
        ResetPasswordContent(
            state = ResetPasswordUiState(hasLink = true, password = "hunter22"),
            onPasswordChange = {},
            onConfirmPasswordChange = {},
            onSubmit = {},
            onNavigateToLogin = {},
        )
    }
}

/** Opened without a link, or with one that Supabase has already spent. */
@Preview(name = "Reset password no link", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ResetPasswordNoLinkPreview() {
    BallastTheme(darkTheme = false) {
        ResetPasswordContent(
            state = ResetPasswordUiState(
                hasLink = false,
                linkProblem = "Email link is invalid or has expired",
            ),
            onPasswordChange = {},
            onConfirmPasswordChange = {},
            onSubmit = {},
            onNavigateToLogin = {},
        )
    }
}
