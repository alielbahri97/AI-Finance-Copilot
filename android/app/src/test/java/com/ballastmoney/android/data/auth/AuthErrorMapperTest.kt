package com.ballastmoney.android.data.auth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.io.IOException

/**
 * The mapping table, asserted against the web app's wording.
 *
 * The point of these is not that the code has a `when` in it. It is that
 * `src/lib/auth/passkeys.ts` and this file say the same sentence for the same
 * failure: a user who hits `webauthn_credential_not_found` on their laptop and
 * again on their phone must not be told two different things and left to work
 * out whether that is one problem or two. Every expected string below is a copy
 * of the web's, so changing one without the other fails here.
 */
class AuthErrorMapperTest {

    private fun textFor(code: String): String {
        val described = AuthErrorMapper.describe(code = code, message = "raw supabase text")
        return (described as AuthErrorMessage.Text).value
    }

    @ParameterizedTest(name = "{0} maps to its own sentence")
    @CsvSource(
        delimiter = '|',
        value = [
            "ERROR_INVALID_DOMAIN|Passkeys are not available on this domain. Use HTTPS on your app domain, or sign in with your password.",
            "ERROR_INVALID_RP_ID|Passkeys are not available on this domain. Use HTTPS on your app domain, or sign in with your password.",
            "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED|This authenticator is already registered on your account.",
            "passkey_disabled|Passkey sign-in is not enabled for this project yet. Use your password, or ask an admin to turn on Passkeys in Supabase Auth.",
            "webauthn_challenge_expired|The biometric prompt timed out. Try again.",
            "webauthn_credential_not_found|No passkey matched this account on this device. Sign in with your password, then enable a passkey in Settings.",
            "webauthn_credential_exists|This authenticator is already registered on your account.",
            "too_many_passkeys|You have reached the maximum number of passkeys for this account. Remove one in Settings, then try again.",
            "webauthn_verification_failed|The authenticator response could not be verified. Try again.",
            "email_not_confirmed|This account still needs confirming. Open the link in the email we sent you, then sign in.",
            "user_banned|This account cannot sign in right now.",
        ],
    )
    fun passkeyCodesUseTheWebWording(code: String, expected: String) {
        assertEquals(expected, textFor(code))
    }

    @ParameterizedTest(name = "{0} maps to its own sentence")
    @CsvSource(
        delimiter = '|',
        value = [
            "invalid_credentials|That email and password do not match an account. Check for typos, or reset your password below.",
            "email_address_invalid|Enter a valid email address",
            "validation_failed|Enter a valid email address",
            "weak_password|That password is too weak. Use at least 8 characters with a lowercase letter, an uppercase letter and a number.",
            "same_password|That is already your password. Choose a different one.",
            "email_exists|An account already exists for that email. Sign in instead, or reset your password.",
            "user_already_exists|An account already exists for that email. Sign in instead, or reset your password.",
            "signup_disabled|New accounts are not being accepted at the moment.",
            "email_provider_disabled|Email and password sign-in is turned off for this project. Ask an admin to enable the Email provider in Supabase Auth.",
            "over_request_rate_limit|Too many attempts. Wait a minute, then try again.",
            "over_email_send_rate_limit|We have sent too many emails to this address recently. Wait a few minutes, then try again.",
            "otp_expired|That link has expired. Ask for a new password reset email and open the newest one.",
            "flow_state_expired|That link has expired. Ask for a new password reset email and open the newest one.",
            "flow_state_not_found|That link was not meant for this device. Ask for a new password reset email and open it on the phone you are signing in on.",
            "bad_code_verifier|That link was not meant for this device. Ask for a new password reset email and open it on the phone you are signing in on.",
            "session_not_found|Your session has expired. Sign in again.",
            "refresh_token_not_found|Your session has expired. Sign in again.",
            "refresh_token_already_used|Your session has expired. Sign in again.",
        ],
    )
    fun passwordCodesUseTheWebWording(code: String, expected: String) {
        assertEquals(expected, textFor(code))
    }

    @ParameterizedTest(name = "the DOMException name {0} is silence")
    @ValueSource(strings = ["NotAllowedError", "AbortError"])
    @DisplayName("a dismissed prompt produces no message at all")
    fun cancellationNamesAreSilent(name: String) {
        assertSame(AuthErrorMessage.Cancelled, AuthErrorMapper.describe(name = name))
    }

    @Test
    @DisplayName("an aborted ceremony is a cancellation, not a failure")
    fun ceremonyAbortedIsSilent() {
        assertSame(
            AuthErrorMessage.Cancelled,
            AuthErrorMapper.describe(code = "ERROR_CEREMONY_ABORTED"),
        )
    }

    @ParameterizedTest(name = "\"{0}\" reads as a cancellation")
    @ValueSource(
        strings = [
            "The user cancelled the request",
            "Request canceled",
            "The request was cancelled by the user",
            "The operation either timed out or was not allowed",
            // Case-insensitive, as the web's /i flag makes it.
            "USER CANCELLED",
        ],
    )
    fun cancellationMessagesAreSilent(message: String) {
        assertSame(AuthErrorMessage.Cancelled, AuthErrorMapper.describe(message = message))
    }

    @Test
    @DisplayName("credential-manager cancellations map onto the ported names")
    fun credentialManagerCancellationIsSilent() {
        assertSame(
            AuthErrorMessage.Cancelled,
            AuthErrorMapper.describe(GetCredentialCancellationException()),
        )
        assertSame(
            AuthErrorMessage.Cancelled,
            AuthErrorMapper.describe(CreateCredentialCancellationException()),
        )
    }

    @Test
    @DisplayName("a code the table does not know falls through to the raw text")
    fun unknownCodeKeepsTheServerMessage() {
        val described = AuthErrorMapper.describe(
            code = "some_future_supabase_code",
            message = "Something specific the server said",
        )
        assertEquals(
            AuthErrorMessage.Text("Something specific the server said"),
            described,
        )
    }

    @Test
    @DisplayName("an unknown code with no text falls back to the passkey sentence")
    fun unknownCodeWithNoTextUsesTheWebFallback() {
        assertEquals(
            AuthErrorMessage.Text(
                "Could not complete passkey authentication. Try again, or use your password.",
            ),
            AuthErrorMapper.describe(),
        )
    }

    @Test
    @DisplayName("an unsupported-WebAuthn message names the secure-context requirement")
    fun insecureContextIsExplained() {
        val described = AuthErrorMapper.describe(
            message = "PublicKeyCredential is not supported outside a secure context",
        )
        assertEquals(
            AuthErrorMessage.Text("Passkeys need a secure connection (HTTPS) or localhost."),
            described,
        )
    }

    @Test
    @DisplayName("no error object at all is the web's generic sentence")
    fun nullErrorIsGeneric() {
        assertEquals(
            AuthErrorMessage.Text(AuthErrorMapper.GENERIC_ERROR),
            AuthErrorMapper.describe(null),
        )
    }

    @Test
    @DisplayName("a socket that never opened is a connection message, not its own text")
    fun ioExceptionIsANetworkMessage() {
        assertEquals(
            AuthErrorMessage.Text(AuthErrorMapper.NETWORK_ERROR),
            AuthErrorMapper.describe(IOException("failed to connect to /10.0.2.2 (port 3000)")),
        )
    }

    @Test
    @DisplayName("a plain exception is described by its own message")
    fun plainExceptionKeepsItsMessage() {
        assertEquals(
            AuthErrorMessage.Text("That reset link is missing the part we need."),
            AuthErrorMapper.describe(
                IllegalStateException("That reset link is missing the part we need."),
            ),
        )
    }
}

// androidx.credentials reports a dismissed sheet with these class names rather
// than as a NotAllowedError, and AuthErrorMapper matches on the name so that it
// need not depend on the credentials library while passkeys are off. Declared
// here rather than imported for the same reason, and at file level rather than
// inside the test so that `simpleName` is unambiguous.

private class GetCredentialCancellationException : RuntimeException("activity is cancelled")

private class CreateCredentialCancellationException : RuntimeException("user cancelled")
