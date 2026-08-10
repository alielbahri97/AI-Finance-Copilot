import "server-only";

/**
 * Google Play Billing configuration, read lazily.
 *
 * Nothing here runs at import time and nothing throws on a missing value: the
 * app has to build and boot without Play configured, exactly as it already does
 * without Stripe keys, and report the gap through a flag instead of crashing.
 * `isPlayBillingConfigured()` is the Play equivalent of `isBillingConfigured()`.
 */

export interface PlayServiceAccount {
  clientEmail: string;
  /** PKCS#8 PEM, with real newlines. */
  privateKey: string;
  projectId?: string;
}

export interface PlayConfig {
  packageName: string;
  serviceAccount: PlayServiceAccount;
}

/** Missing configuration, told apart from a genuine Google failure. */
export class PlayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayConfigError";
  }
}

function trimmed(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The Android application id, e.g. "com.ballastmoney.app". */
export function playPackageName(): string | null {
  return trimmed("GOOGLE_PLAY_PACKAGE_NAME");
}

/**
 * Parses the service-account credential.
 *
 * One variable holding the whole JSON key, either raw or base64-encoded, rather
 * than a handful of separate fields: the private key is multi-line PEM, and
 * splitting a credential across variables that must agree is how half of a
 * credential ends up deployed. Base64 is accepted because most secret stores
 * mangle embedded newlines, and it is detected rather than configured.
 */
export function playServiceAccount(): PlayServiceAccount | null {
  const raw = trimmed("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;

  let json = raw;
  if (!json.startsWith("{")) {
    try {
      json = Buffer.from(json, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKeyRaw = typeof record.private_key === "string" ? record.private_key : "";
  if (!clientEmail || !privateKeyRaw) return null;

  return {
    clientEmail,
    // A key pasted into a .env file usually arrives with literal backslash-n.
    privateKey: privateKeyRaw.includes("\\n")
      ? privateKeyRaw.replace(/\\n/g, "\n")
      : privateKeyRaw,
    projectId: typeof record.project_id === "string" ? record.project_id : undefined,
  };
}

/**
 * The audience the Pub/Sub push subscription is configured to mint OIDC tokens
 * for. Checking it is what stops a token minted for some other service — or
 * some other app on the same project — from being replayed at this endpoint.
 */
export function playPubsubAudience(): string | null {
  return trimmed("GOOGLE_PLAY_PUBSUB_AUDIENCE");
}

/**
 * Optional: the service account Pub/Sub signs push tokens with. When set, the
 * notifications endpoint additionally requires the token's `email` claim to
 * match, which narrows trust from "any Google-issued OIDC token for this
 * audience" to one identity.
 */
export function playPubsubServiceAccountEmail(): string | null {
  return trimmed("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT");
}

/** True when a purchase can actually be verified against Google. */
export function isPlayBillingConfigured(): boolean {
  return Boolean(playPackageName() && playServiceAccount());
}

/** True when a Pub/Sub push can be authenticated. */
export function isPlayNotificationsConfigured(): boolean {
  return Boolean(playPubsubAudience());
}

/** Throws PlayConfigError rather than returning a half-configured object. */
export function requirePlayConfig(): PlayConfig {
  const packageName = playPackageName();
  if (!packageName) {
    throw new PlayConfigError("GOOGLE_PLAY_PACKAGE_NAME is not set.");
  }
  const serviceAccount = playServiceAccount();
  if (!serviceAccount) {
    throw new PlayConfigError(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing, not valid JSON, or has no client_email/private_key."
    );
  }
  return { packageName, serviceAccount };
}
