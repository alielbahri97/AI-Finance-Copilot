package com.ballastmoney.android.ui.auth

import com.ballastmoney.android.core.model.WorkspaceType

/**
 * Every user-visible string on the four auth screens.
 *
 * Gathered here rather than inlined for the same reason `src/lib/branding.ts`
 * exists on the web: the product name, the edition names and the confirmation
 * copy appear in several places each, and the two clients have to say the same
 * thing. Where the web has wording, it is copied verbatim — a person who resets
 * their password on a laptop and then signs in on a phone should recognise the
 * sentences.
 *
 * Not extracted to `strings.xml`. The app has no translations and none are
 * planned in this release; a Kotlin object keeps the copy next to the reasoning
 * and lets the previews and unit tests read it directly.
 */
object AuthCopy {

    const val APP_NAME = "Ballast"

    // --- Sign in ---------------------------------------------------------

    const val LOGIN_TITLE = "Welcome back"
    const val LOGIN_SUBTITLE = "Sign in to your $APP_NAME account"
    const val LOGIN_SUBMIT = "Sign in"
    const val LOGIN_ERROR_TITLE = "Sign in failed"
    const val FORGOT_PASSWORD_LINK = "Forgot password?"
    const val NO_ACCOUNT = "No account yet?"
    const val CREATE_ONE = "Create one"

    // --- Sign up ---------------------------------------------------------

    const val SIGNUP_TITLE = "Create your account"
    const val SIGNUP_SUBMIT = "Create account"
    const val SIGNUP_ERROR_TITLE = "Sign up failed"
    const val HAVE_ACCOUNT = "Already have an account?"
    const val SIGN_IN = "Sign in"

    const val EDITION_QUESTION = "What is this account for?"

    /** `MailCheckIcon` alert on the web, after a successful sign-up. */
    const val CONFIRM_EMAIL_TITLE = "Confirm your email"
    const val RESEND_CONFIRMATION = "Resend confirmation"
    const val WRONG_ADDRESS = "Wrong address?"
    const val SIGNUP_AGAIN_NOTE =
        "Signing up again with a corrected address creates the account there instead — " +
            "the unconfirmed one expires on its own."

    /** Seconds Supabase makes a user wait between confirmation emails. */
    const val RESEND_COOLDOWN_SECONDS = 60

    fun confirmEmailBody(email: String): String =
        "We sent a confirmation link to $email. Click it to activate your account, then " +
            "sign in. It can take a minute to arrive — check your spam folder too."

    fun resendIn(seconds: Int): String = "Resend in ${seconds}s"

    // --- Forgot password -------------------------------------------------

    const val FORGOT_TITLE = "Reset your password"
    const val FORGOT_SUBTITLE =
        "We will email you a link that signs you in so you can choose a new password."
    const val FORGOT_SUBMIT = "Send reset link"
    const val FORGOT_ERROR_TITLE = "Could not send reset email"
    const val FORGOT_SENT_TITLE = "Check your inbox"

    /**
     * Says "if an account exists" rather than confirming one does. Supabase
     * answers an unknown address with success for the same reason: a form that
     * tells a stranger which addresses are registered is an account-enumeration
     * hole.
     */
    const val FORGOT_SENT_BODY =
        "If an account exists for that email, you will receive a link to reset your password."

    const val BACK_TO_SIGN_IN = "Back to sign in"

    // --- Reset password --------------------------------------------------

    const val RESET_TITLE = "Choose a new password"
    const val RESET_SUBTITLE = "You opened a reset link, so this is the last step."
    const val RESET_SUBMIT = "Update password"
    const val RESET_ERROR_TITLE = "Could not update password"

    /** Reached by opening the screen without a usable link in the intent. */
    const val RESET_NO_LINK_TITLE = "That link did not carry a reset code"
    const val RESET_NO_LINK_BODY =
        "Reset links only work once and expire after an hour. Ask for a new one and open " +
            "the newest email."

    // --- Fields ----------------------------------------------------------

    const val FULL_NAME_LABEL = "Full name"
    const val FULL_NAME_PLACEHOLDER = "Ada Lovelace"
    const val EMAIL_LABEL = "Email"
    const val EMAIL_PLACEHOLDER = "you@example.com"
    const val PASSWORD_LABEL = "Password"
    const val CONFIRM_PASSWORD_LABEL = "Confirm password"
    const val NEW_PASSWORD_LABEL = "New password"
    const val CONFIRM_NEW_PASSWORD_LABEL = "Confirm new password"
    const val REFERRAL_LABEL = "Referral code"
    const val REFERRAL_PLACEHOLDER = "Optional"

    /** `••••••••` on the web; the same eight bullets. */
    const val PASSWORD_PLACEHOLDER = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"

    const val SHOW_PASSWORD = "Show password"
    const val HIDE_PASSWORD = "Hide password"

    // --- Configuration ---------------------------------------------------

    const val NOT_CONFIGURED_TITLE = "This build has no Supabase credentials"

    // --- Editions --------------------------------------------------------

    /** `EDITIONS[...].name` in `src/lib/branding.ts`. */
    fun editionName(type: WorkspaceType): String = when (type) {
        WorkspaceType.BUSINESS -> "$APP_NAME Business"
        WorkspaceType.PERSONAL -> "$APP_NAME Personal"
    }

    /** `choiceLabel`: how a visitor says which they are. */
    fun editionChoiceLabel(type: WorkspaceType): String = when (type) {
        WorkspaceType.BUSINESS -> "For my business"
        WorkspaceType.PERSONAL -> "For myself"
    }

    /** `choiceDescription`: one line naming the concrete job it does. */
    fun editionChoiceDescription(type: WorkspaceType): String = when (type) {
        WorkspaceType.BUSINESS -> "Invoices, VAT, cash flow and a team that shares the numbers."
        WorkspaceType.PERSONAL -> "Budgets, savings goals and every subscription you forgot about."
    }
}
