package com.ballastmoney.android.data.auth

/**
 * Passkeys are written up, mapped and switched off.
 *
 * ### Why the flag is `false`
 *
 * supabase-kt 3.7.0 exposes `auth.passkeys` (an experimental `AuthPasskeyApi`)
 * but ships no wrapper that drives the platform prompt. On Android the ceremony
 * would have to be run by hand: take the creation or request options JSON from
 * Supabase, hand it to `androidx.credentials` as a
 * `CreatePublicKeyCredentialRequest` or a `GetPublicKeyCredentialOption`, and
 * post the authenticator's response back. Two things about that are worth
 * writing down because they are easy to get wrong:
 *
 *  - the request JSON for a **native** app must not carry an `origin` field.
 *    Credential Manager derives the origin from the calling package's signing
 *    certificate; supplying one makes the call a privileged-browser request,
 *    which an ordinary app is not allowed to make and which fails at the
 *    platform, not at Supabase.
 *  - the relying party must accept an `android:apk-key-hash:<base64url sha-256
 *    of the signing certificate>` origin. That is a Supabase-side allow-list
 *    entry, and the hash comes from the Play App Signing key, which is not
 *    available in this repository.
 *
 * On top of that the passkey has to be associated with the app: a
 * `assetlinks.json` at `https://app.ballastmoney.com/.well-known/assetlinks.json`
 * containing a `delegate_permission/common.get_login_creds` relation for
 * `com.ballastmoney.android` and the same certificate fingerprint. Without it
 * Credential Manager refuses to release or create a credential for that domain.
 *
 * None of those three can be done from here — they need the Play signing key
 * and Supabase dashboard access — so shipping the ceremony would mean shipping
 * a button that always fails. Email and password works instead, and the exact
 * remaining steps are in the handover notes.
 *
 * ### What is already done
 *
 * [AuthErrorMapper] maps every passkey and WebAuthn code the web app handles,
 * with the web app's wording, and treats a dismissed prompt as silence rather
 * than as an error. That is the part with product value and it is tested. When
 * the flag flips, the failure copy is already right.
 *
 * A `const val` rather than a `BuildConfig` field because `build.gradle.kts` is
 * owned elsewhere; flipping this is a one-line edit either way.
 */
object PasskeySupport {

    /**
     * Turn on only once the three prerequisites above are in place, and only
     * together with a real ceremony implementation.
     */
    const val ENABLED = false

    /** Shown next to a disabled control if one is ever surfaced early. */
    const val UNAVAILABLE_REASON =
        "Passkey sign-in is not enabled for this project yet. Use your password, " +
            "or ask an admin to turn on Passkeys in Supabase Auth."
}
