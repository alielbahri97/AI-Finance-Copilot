/**
 * Client-side helpers for Supabase Auth passkeys (WebAuthn).
 *
 * Credentials and challenges live in Supabase Auth — we never store passwords
 * or private keys in localStorage. The browser client must opt into
 * `auth.experimental.passkey` (see `src/lib/supabase/client.ts`).
 */

export type PasskeyUiMode = "hidden" | "biometric" | "passkey";

export type PasskeySupport = {
  mode: PasskeyUiMode;
  /** True when WebAuthn APIs exist in a secure context. */
  webAuthn: boolean;
  /** True when a platform authenticator (Face ID / Touch ID / Windows Hello) is likely. */
  platformAuthenticator: boolean;
};

/**
 * Detects whether this browser can run a passkey ceremony and which button
 * label to show. Safe to call only in the browser (returns hidden on SSR).
 */
export async function detectPasskeySupport(): Promise<PasskeySupport> {
  if (typeof window === "undefined") {
    return { mode: "hidden", webAuthn: false, platformAuthenticator: false };
  }

  if (!window.isSecureContext) {
    return { mode: "hidden", webAuthn: false, platformAuthenticator: false };
  }

  const PublicKeyCredentialCtor = window.PublicKeyCredential;
  if (
    !PublicKeyCredentialCtor ||
    typeof navigator.credentials?.create !== "function" ||
    typeof navigator.credentials?.get !== "function"
  ) {
    return { mode: "hidden", webAuthn: false, platformAuthenticator: false };
  }

  let platformAuthenticator = false;
  try {
    if (typeof PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      platformAuthenticator =
        await PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    platformAuthenticator = false;
  }

  return {
    mode: platformAuthenticator ? "biometric" : "passkey",
    webAuthn: true,
    platformAuthenticator,
  };
}

export function passkeySignInLabel(mode: Exclude<PasskeyUiMode, "hidden">): string {
  return mode === "biometric" ? "Sign in with Face ID / fingerprint" : "Sign in with passkey";
}

export function passkeyRegisterLabel(mode: Exclude<PasskeyUiMode, "hidden">): string {
  return mode === "biometric" ? "Enable biometric / passkey login" : "Enable passkey login";
}

/**
 * Maps WebAuthn / Supabase Auth errors to a short user-facing message.
 * Returns `null` when the user cancelled the prompt — callers should stay quiet.
 */
export function describePasskeyError(error: unknown): string | null {
  if (!error) return "Something went wrong. Please try again.";

  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    code === "ERROR_CEREMONY_ABORTED"
  ) {
    return null;
  }
  if (/user cancelled|canceled|cancelled by the user|the operation either timed out or was not allowed/i.test(message)) {
    return null;
  }

  switch (code) {
    case "ERROR_INVALID_DOMAIN":
    case "ERROR_INVALID_RP_ID":
      return "Passkeys are not available on this domain. Use HTTPS on your app domain, or sign in with your password.";
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "This authenticator is already registered on your account.";
    case "passkey_disabled":
      return "Passkey sign-in is not enabled for this project yet. Use your password, or ask an admin to turn on Passkeys in Supabase Auth.";
    case "webauthn_challenge_expired":
      return "The biometric prompt timed out. Try again.";
    case "webauthn_credential_not_found":
      return "No passkey matched this account on this device. Sign in with your password, then enable a passkey in Settings.";
    case "webauthn_credential_exists":
      return "This authenticator is already registered on your account.";
    case "too_many_passkeys":
      return "You have reached the maximum number of passkeys for this account. Remove one in Settings, then try again.";
    case "webauthn_verification_failed":
      return "The authenticator response could not be verified. Try again.";
    case "email_not_confirmed":
      return "This account still needs confirming. Open the link in the email we sent you, then sign in.";
    case "user_banned":
      return "This account cannot sign in right now.";
    default:
      break;
  }

  if (/not supported|publickeycredential|webauthn/i.test(message) && /secure context|https/i.test(message)) {
    return "Passkeys need a secure connection (HTTPS) or localhost.";
  }

  return message || "Could not complete passkey authentication. Try again, or use your password.";
}
