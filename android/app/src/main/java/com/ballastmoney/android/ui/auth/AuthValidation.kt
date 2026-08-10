package com.ballastmoney.android.ui.auth

/**
 * The Android half of `src/lib/validations/auth.ts`.
 *
 * Same rules, same sentences. The web validates with Zod before it calls
 * Supabase; this does the same before it calls [com.ballastmoney.android.data.auth.AuthRepository],
 * for the same reason — a round trip to say "that is not an email address" is a
 * round trip the user waits for, and Supabase's own answer for a short password
 * is "Password should be at least 6 characters", which is not the rule Ballast
 * enforces.
 *
 * Pure functions over strings, so the rules are testable without a device and
 * the ViewModels stay about state rather than about regular expressions.
 */
object AuthValidation {

    /**
     * Deliberately loose: something, an `@`, something with a dot in it, and no
     * spaces anywhere.
     *
     * A stricter pattern is a liability, not an asset. RFC 5322 permits
     * addresses that look wrong and real registrars keep inventing new
     * top-level domains, so every extra rule here is a way to lock a legitimate
     * customer out of signing up. The address is confirmed by email anyway,
     * which is the only check that proves anything.
     */
    private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

    private val LOWERCASE = Regex("[a-z]")
    private val UPPERCASE = Regex("[A-Z]")
    private val DIGIT = Regex("[0-9]")

    /** Null when valid; otherwise the message to put under the field. */
    fun email(value: String): String? =
        if (EMAIL.matches(value.trim())) null else "Enter a valid email address"

    /** Sign-in only asks that something was typed; the server judges the rest. */
    fun signInPassword(value: String): String? =
        if (value.isNotEmpty()) null else "Password is required"

    fun fullName(value: String): String? =
        if (value.trim().length >= MIN_FULL_NAME) null else "Enter your full name"

    /** The four checks the web applies, reported one at a time in the same order. */
    fun newPassword(value: String): String? = when {
        value.length < MIN_PASSWORD -> "Password must be at least $MIN_PASSWORD characters"
        !LOWERCASE.containsMatchIn(value) -> "Include at least one lowercase letter"
        !UPPERCASE.containsMatchIn(value) -> "Include at least one uppercase letter"
        !DIGIT.containsMatchIn(value) -> "Include at least one number"
        else -> null
    }

    fun confirmation(password: String, confirmation: String): String? =
        if (password == confirmation) null else "Passwords do not match"

    private const val MIN_FULL_NAME = 2
    private const val MIN_PASSWORD = 8
}
