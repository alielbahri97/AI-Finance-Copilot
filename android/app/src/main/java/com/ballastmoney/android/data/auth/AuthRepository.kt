package com.ballastmoney.android.data.auth

import com.ballastmoney.android.core.model.WorkspaceType
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/**
 * How an auth call ended.
 *
 * [Cancelled] exists so a dismissed system prompt can travel back through the
 * same channel as a failure without becoming an error message. Email and
 * password never produces it in practice — there is no prompt to dismiss — but
 * the passkey paths will, and having the case in the type is what stops it
 * being forgotten then: every `when` over this is already exhaustive.
 */
sealed interface AuthOutcome {

    data object Success : AuthOutcome

    /** The user dismissed a prompt. Show nothing. */
    data object Cancelled : AuthOutcome

    data class Failure(val message: String) : AuthOutcome
}

/**
 * Every write against Supabase Auth, in one place.
 *
 * Reads are not here: "who is signed in" is [SupabaseAuthGateway], because the
 * HTTP layer and the app shell need it and neither should have to know about a
 * repository. This class is the verbs.
 *
 * ### Why the signup metadata looks like that
 *
 * [signUp] puts `full_name`, `workspace_type` and, when there is one,
 * `referral_code` into Supabase user metadata. That is not a shortcut for
 * skipping an API call — it is the only carrier that survives the round trip.
 * A sign-up sends a confirmation email; the user might open it hours later, on
 * a different device, possibly on the web. Nothing the client held at sign-up
 * time is still around when they come back, and no row exists in the Ballast
 * database yet to write it to. User metadata is attached to the Supabase user
 * itself, so it arrives intact with the confirmed session and the server reads
 * it when it creates the first workspace. `src/lib/workspace/editions.ts` says
 * the same thing about the same key, and the web signup form
 * (`src/components/auth/signup-form.tsx`) sends exactly these three fields — the
 * server is written against that shape, so this client matches it rather than
 * inventing its own.
 *
 * The key is `workspace_type` and the value is the lowercase `personal` or
 * `business` produced by `workspaceTypeParam`, not the `PERSONAL`/`BUSINESS`
 * enum spelling. The web's parser accepts both, but matching what the web
 * actually sends keeps one shape in the database.
 */
@Singleton
class AuthRepository @Inject constructor(
    private val clientProvider: SupabaseClientProvider,
) {

    suspend fun signIn(emailAddress: String, rawPassword: String): AuthOutcome =
        perform { auth ->
            auth.signInWith(Email) {
                email = emailAddress.trim()
                password = rawPassword
            }
        }

    /**
     * Always ends on "check your inbox", the same as the web form.
     *
     * When email confirmation is on, Supabase returns a user with no session.
     * When it is off, sign-up signs the user straight in and the shell follows
     * [SupabaseAuthGateway.isSignedIn] into the app, leaving the confirmation
     * notice behind. Both are correct; the screen does not need to know which
     * happened.
     */
    suspend fun signUp(
        fullName: String,
        emailAddress: String,
        rawPassword: String,
        edition: WorkspaceType,
        referralCode: String? = null,
    ): AuthOutcome = perform { auth ->
        auth.signUpWith(Email, redirectUrl = AuthDeepLink.EMAIL_CONFIRMED) {
            email = emailAddress.trim()
            password = rawPassword
            data = buildJsonObject {
                put(FULL_NAME_KEY, fullName.trim())
                put(EDITION_METADATA_KEY, edition.metadataValue())
                referralCode?.trim()?.takeIf { it.isNotEmpty() }?.let { code ->
                    put(REFERRAL_CODE_KEY, code)
                }
            }
        }
    }

    /** Resends the confirmation email for an address that has not been confirmed. */
    suspend fun resendConfirmationEmail(emailAddress: String): AuthOutcome =
        perform { auth ->
            auth.resendEmail(
                type = OtpType.Email.SIGNUP,
                email = emailAddress.trim(),
                redirectUrl = AuthDeepLink.EMAIL_CONFIRMED,
            )
        }

    /**
     * Always reports success to the caller when the request itself succeeded,
     * including for an address with no account. Supabase behaves the same way,
     * and the web app's copy — "If an account exists for that email…" — is
     * written around it: telling a stranger which addresses are registered is
     * an account-enumeration hole.
     */
    suspend fun sendPasswordResetEmail(emailAddress: String): AuthOutcome =
        perform { auth ->
            auth.resetPasswordForEmail(
                email = emailAddress.trim(),
                redirectUrl = AuthDeepLink.RESET_PASSWORD,
            )
        }

    /**
     * Turns a recovery link into a session and immediately changes the
     * password.
     *
     * The two halves are one operation on purpose, and two things about that
     * are worth stating.
     *
     * [NonCancellable], because the first half signs the user in, which flips
     * [SupabaseAuthGateway.isSignedIn] and makes the shell swap the sign-in
     * graph for the app — taking this screen's ViewModel, and its coroutine
     * scope, with it. Without it the password change would be abandoned half
     * way through its own success. It is the only place in this file that needs
     * it, because it is the only place where succeeding destroys the caller.
     *
     * And the sign-out on failure, because the alternative is silently worse: a
     * recovery link grants a real session before the new password is set, so a
     * rejected password (Supabase's leaked-password check, or `same_password`)
     * would otherwise leave someone signed in, with their old password intact,
     * on a screen that no longer exists to tell them. Undoing the sign-in puts
     * them back where they can read the reason and try again.
     */
    suspend fun completePasswordReset(link: AuthCallbackLink, newPassword: String): AuthOutcome =
        withContext(NonCancellable) {
            val auth = clientProvider.auth ?: return@withContext configurationFailure()
            try {
                establishSession(auth, link)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Throwable) {
                return@withContext describe(error)
            }
            try {
                auth.updateUser { password = newPassword }
                AuthOutcome.Success
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Throwable) {
                runCatching { auth.signOut() }
                describe(error)
            }
        }

    /**
     * Signs in from a confirmation link, whose only job is to bring the user
     * back into the app authenticated.
     *
     * A failure here is deliberately quiet. The link is either expired or
     * already spent, and the user is left where they were — the sign-in screen
     * — where typing their password produces "This account still needs
     * confirming", which is both true and actionable. An error banner about a
     * link they have already closed would be neither.
     */
    suspend fun completeEmailConfirmation(link: AuthCallbackLink): AuthOutcome =
        perform { auth -> establishSession(auth, link) }

    /**
     * Ends the session on this device only.
     *
     * `SignOutScope.LOCAL` is supabase-kt's default and is the right one:
     * signing out of a phone should not sign the same person out of the laptop
     * they left a report open on.
     */
    suspend fun signOut(): AuthOutcome = perform { auth -> auth.signOut() }

    private suspend fun establishSession(auth: Auth, link: AuthCallbackLink) {
        val code = link.code
        if (code != null) {
            auth.exchangeCodeForSession(code)
            return
        }
        val accessToken = link.accessToken
        val refreshToken = link.refreshToken
        if (accessToken != null && refreshToken != null) {
            auth.importSession(
                UserSession(
                    accessToken = accessToken,
                    refreshToken = refreshToken,
                    expiresIn = link.expiresIn ?: DEFAULT_EXPIRES_IN_SECONDS,
                    tokenType = link.tokenType ?: DEFAULT_TOKEN_TYPE,
                ),
            )
            return
        }
        throw IllegalStateException(link.errorDescription ?: INCOMPLETE_LINK)
    }

    /**
     * One shape for every call: run it, and turn anything thrown into a
     * sentence.
     *
     * `CancellationException` is re-thrown rather than described. Swallowing it
     * would report "the coroutine was cancelled" to a user who navigated away,
     * and would break structured concurrency for everything upstream.
     */
    private suspend fun perform(block: suspend (Auth) -> Unit): AuthOutcome {
        val auth = clientProvider.auth ?: return configurationFailure()
        return try {
            block(auth)
            AuthOutcome.Success
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Throwable) {
            describe(error)
        }
    }

    private fun describe(error: Throwable): AuthOutcome =
        when (val described = AuthErrorMapper.describe(error)) {
            AuthErrorMessage.Cancelled -> AuthOutcome.Cancelled
            is AuthErrorMessage.Text -> AuthOutcome.Failure(described.value)
        }

    /** No client at all means no credentials; say which file to fill in. */
    private fun configurationFailure(): AuthOutcome = AuthOutcome.Failure(
        clientProvider.configurationProblem ?: AuthErrorMapper.GENERIC_ERROR,
    )

    private fun WorkspaceType.metadataValue(): String = when (this) {
        WorkspaceType.PERSONAL -> "personal"
        WorkspaceType.BUSINESS -> "business"
    }

    private companion object {
        /** `EDITION_METADATA_KEY` in `src/lib/workspace/editions.ts`. */
        const val EDITION_METADATA_KEY = "workspace_type"
        const val FULL_NAME_KEY = "full_name"
        const val REFERRAL_CODE_KEY = "referral_code"

        /** Supabase's own default access-token lifetime, used only as a floor. */
        const val DEFAULT_EXPIRES_IN_SECONDS = 3600L
        const val DEFAULT_TOKEN_TYPE = "bearer"

        const val INCOMPLETE_LINK =
            "That reset link is missing the part we need. Ask for a new password reset " +
                "email and open the newest one."
    }
}
