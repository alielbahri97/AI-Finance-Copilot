package com.ballastmoney.android.data.auth

import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.exceptions.RestException
import java.io.IOException

/**
 * What to show the user, or nothing at all.
 *
 * The two cases are separate types rather than a nullable string because the
 * distinction is a product decision, not an absence of data: a user who
 * dismissed a biometric prompt made a choice and does not need it reported back
 * to them as an error. The web app models the same thing by returning `null`
 * from `describePasskeyError`.
 */
sealed interface AuthErrorMessage {

    /** The user cancelled a prompt. Callers stay quiet. */
    data object Cancelled : AuthErrorMessage

    data class Text(val value: String) : AuthErrorMessage
}

/**
 * The Android port of `src/lib/auth/passkeys.ts#describePasskeyError`, plus the
 * ordinary email-and-password failures.
 *
 * The wording is copied from the web app verbatim, including the passkey
 * strings that nothing calls yet — see [PasskeySupport]. Two clients that
 * describe the same failure differently is a support problem: someone reads a
 * sentence on their laptop, then a different sentence on their phone, and
 * cannot tell whether they are looking at one problem or two. So the strings
 * are the shared artefact even where the code paths are not, and the passkey
 * half is written and tested now so that turning passkeys on later is a
 * question of driving the ceremony rather than of inventing copy.
 *
 * The password strings come from `login-form.tsx#describeSignInError` where the
 * web has one, and are new here where it does not — the web falls through to
 * Supabase's own `error.message` for those, which says things like "Invalid
 * login credentials" and leaves the reader to work out what to do.
 *
 * [describe] with three strings is the faithful port and is pure, so the whole
 * table is testable on the JVM. The [Throwable] overload is the adapter that
 * pulls a name, a code and a message out of whatever supabase-kt or
 * androidx.credentials threw.
 */
object AuthErrorMapper {

    /** The web app's answer when there is no error object at all. */
    const val GENERIC_ERROR = "Something went wrong. Please try again."

    /** The web app's `catch` branch on every auth form. */
    const val NETWORK_ERROR =
        "We could not reach the server. Check your connection and try again."

    /**
     * Faithful port. [name] is the DOMException-style name on the web and the
     * exception's simple name here, [code] is the Supabase or credential-manager
     * error code, [message] the raw text.
     */
    fun describe(name: String = "", code: String = "", message: String = ""): AuthErrorMessage {
        if (name == "NotAllowedError" || name == "AbortError" || code == "ERROR_CEREMONY_ABORTED") {
            return AuthErrorMessage.Cancelled
        }
        if (CANCELLED_MESSAGE.containsMatchIn(message)) {
            return AuthErrorMessage.Cancelled
        }

        codeMessages[code]?.let { return AuthErrorMessage.Text(it) }

        if (WEBAUTHN_MESSAGE.containsMatchIn(message) && SECURE_CONTEXT_MESSAGE.containsMatchIn(message)) {
            return AuthErrorMessage.Text("Passkeys need a secure connection (HTTPS) or localhost.")
        }

        return AuthErrorMessage.Text(
            message.ifEmpty {
                "Could not complete passkey authentication. Try again, or use your password."
            },
        )
    }

    /**
     * Adapter for a thrown failure.
     *
     * A null error maps to [GENERIC_ERROR], matching the web's `if (!error)`
     * branch. `IOException` is intercepted before the table because a socket
     * that never opened has no Supabase error code and its `message` is
     * something like "failed to connect to /10.0.2.2", which is not a sentence
     * to show anybody.
     *
     * The raw text is taken from `errorDescription` rather than from `message`
     * for anything Supabase threw: `RestException.message` is assembled for a
     * log file and carries the request URL, the headers and the HTTP method
     * after the actual sentence. Falling through to it would put a masked
     * bearer token on the login screen.
     */
    fun describe(error: Throwable?): AuthErrorMessage {
        if (error == null) return AuthErrorMessage.Text(GENERIC_ERROR)
        if (error is IOException) return AuthErrorMessage.Text(NETWORK_ERROR)

        // `error` on a RestException is the raw code string; on an
        // AuthRestException it is exactly the value AuthErrorCode wraps.
        val code = (error as? RestException)?.error.orEmpty()
        val message = when (error) {
            is AuthRestException -> error.errorDescription
            is RestException -> error.description.orEmpty()
            else -> error.message.orEmpty()
        }
        return describe(
            name = webAuthnName(error),
            code = code,
            message = message.ifBlank { GENERIC_ERROR },
        )
    }

    /**
     * Translates the platform's cancellation exceptions to the DOMException
     * names the ported table already understands.
     *
     * `androidx.credentials` reports a dismissed prompt as
     * `GetCredentialCancellationException` or
     * `CreateCredentialCancellationException` rather than as a
     * `NotAllowedError`, so without this the user would be shown an error for
     * having tapped "cancel". Matched on the simple name so this file does not
     * have to depend on the credentials library while passkeys are switched
     * off.
     *
     * That is a debt, not a design: R8 runs in full mode in release builds and
     * may rename those classes, in which case the match silently stops working
     * and a cancelled prompt becomes an error message. Enabling
     * [PasskeySupport.ENABLED] must therefore also mean replacing this with a
     * real `is GetCredentialCancellationException` check — the dependency is
     * already declared, so it costs an import and a keep rule less.
     */
    private fun webAuthnName(error: Throwable): String {
        val simpleName = error::class.simpleName.orEmpty()
        return if (simpleName.contains("Cancellation") || simpleName.contains("UserCanceled")) {
            "AbortError"
        } else {
            simpleName
        }
    }

    private val CANCELLED_MESSAGE = Regex(
        "user cancelled|canceled|cancelled by the user|" +
            "the operation either timed out or was not allowed",
        RegexOption.IGNORE_CASE,
    )

    private val WEBAUTHN_MESSAGE =
        Regex("not supported|publickeycredential|webauthn", RegexOption.IGNORE_CASE)

    private val SECURE_CONTEXT_MESSAGE =
        Regex("secure context|https", RegexOption.IGNORE_CASE)

    /**
     * Ordered as the web's `switch` is, with the password codes appended.
     *
     * `webauthn_credential_exists` and `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`
     * intentionally share a string: they are the same situation reached from the
     * two different layers, and the web app repeats the sentence rather than
     * distinguishing them.
     */
    private val codeMessages: Map<String, String> = mapOf(
        // --- Ported verbatim from describePasskeyError ---------------------
        "ERROR_INVALID_DOMAIN" to
            "Passkeys are not available on this domain. Use HTTPS on your app domain, " +
            "or sign in with your password.",
        "ERROR_INVALID_RP_ID" to
            "Passkeys are not available on this domain. Use HTTPS on your app domain, " +
            "or sign in with your password.",
        "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" to
            "This authenticator is already registered on your account.",
        "passkey_disabled" to
            "Passkey sign-in is not enabled for this project yet. Use your password, " +
            "or ask an admin to turn on Passkeys in Supabase Auth.",
        "webauthn_challenge_expired" to "The biometric prompt timed out. Try again.",
        "webauthn_credential_not_found" to
            "No passkey matched this account on this device. Sign in with your password, " +
            "then enable a passkey in Settings.",
        "webauthn_credential_exists" to
            "This authenticator is already registered on your account.",
        "too_many_passkeys" to
            "You have reached the maximum number of passkeys for this account. " +
            "Remove one in Settings, then try again.",
        "webauthn_verification_failed" to
            "The authenticator response could not be verified. Try again.",
        "email_not_confirmed" to
            "This account still needs confirming. Open the link in the email we sent you, " +
            "then sign in.",
        "user_banned" to "This account cannot sign in right now.",

        // --- Email and password --------------------------------------------
        // Wording from login-form.tsx#describeSignInError, which exists because
        // Supabase answers a wrong password and an unconfirmed address with the
        // same generic sentence.
        "invalid_credentials" to
            "That email and password do not match an account. Check for typos, " +
            "or reset your password below.",
        "email_address_invalid" to "Enter a valid email address",
        "validation_failed" to "Enter a valid email address",
        "weak_password" to
            "That password is too weak. Use at least 8 characters with a lowercase " +
            "letter, an uppercase letter and a number.",
        "same_password" to "That is already your password. Choose a different one.",
        "email_exists" to
            "An account already exists for that email. Sign in instead, or reset your password.",
        "user_already_exists" to
            "An account already exists for that email. Sign in instead, or reset your password.",
        "signup_disabled" to "New accounts are not being accepted at the moment.",
        "email_provider_disabled" to
            "Email and password sign-in is turned off for this project. Ask an admin to " +
            "enable the Email provider in Supabase Auth.",

        // --- Rate limiting ---------------------------------------------------
        "over_request_rate_limit" to
            "Too many attempts. Wait a minute, then try again.",
        "over_email_send_rate_limit" to
            "We have sent too many emails to this address recently. Wait a few minutes, " +
            "then try again.",

        // --- Expired or spent links -----------------------------------------
        "otp_expired" to
            "That link has expired. Ask for a new password reset email and open the newest one.",
        "flow_state_expired" to
            "That link has expired. Ask for a new password reset email and open the newest one.",
        "flow_state_not_found" to
            "That link was not meant for this device. Ask for a new password reset email " +
            "and open it on the phone you are signing in on.",
        "bad_code_verifier" to
            "That link was not meant for this device. Ask for a new password reset email " +
            "and open it on the phone you are signing in on.",
        "session_not_found" to "Your session has expired. Sign in again.",
        "refresh_token_not_found" to "Your session has expired. Sign in again.",
        "refresh_token_already_used" to "Your session has expired. Sign in again.",
    )
}
