import "server-only";

import { importPKCS8, SignJWT } from "jose";

import { logger, serializeError } from "@/lib/logger";

import { requirePlayConfig, type PlayServiceAccount } from "./config";
import type { PlaySubscriptionPurchaseV2 } from "./state";

/**
 * The two Google Play Developer API calls this app makes, over plain fetch.
 *
 * No `googleapis` client library. That package is tens of megabytes of
 * generated surface for two endpoints, and the whole of what it would do here is
 * sign a JWT and set a header — `jose` is already a dependency for verifying
 * Supabase tokens and does the signing part. It also keeps the serverless bundle
 * small, and this codebase already talks to GoCardless, Stripe's portal and four
 * accounting APIs the same way.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ANDROID_PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Google refused the call. Carries the HTTP status so callers can branch. */
export class PlayApiError extends Error {
  readonly status: number;
  /** Google's own reason string, where it gave one. */
  readonly reason: string | null;

  constructor(status: number, message: string, reason: string | null = null) {
    super(message);
    this.name = "PlayApiError";
    this.status = status;
    this.reason = reason;
  }

  /** True when Google says there is no such purchase token. */
  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410;
  }

  /** True when retrying later could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/* ------------------------------------------------------------------ */
/* Access tokens                                                       */
/* ------------------------------------------------------------------ */

interface CachedToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

const tokens = new Map<string, CachedToken>();

/** Refresh a little early so a token never expires mid-flight. */
const TOKEN_SKEW_MS = 60_000;

/** Test seam: drops the cached access tokens. */
export function resetPlayAccessTokenCache(): void {
  tokens.clear();
}

async function mintAssertion(account: PlayServiceAccount): Promise<string> {
  const key = await importPKCS8(account.privateKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.clientEmail)
    .setSubject(account.clientEmail)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

/**
 * A service-account access token, cached per credential until shortly before it
 * expires. The JWT-bearer grant is used rather than a refresh token because a
 * service account has no user to consent.
 */
export async function playAccessToken(account: PlayServiceAccount): Promise<string> {
  const cached = tokens.get(account.clientEmail);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const assertion = await mintAssertion(account);
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!response.ok || !body?.access_token) {
    throw new PlayApiError(
      response.status,
      `Google refused the service-account token exchange: ${body?.error_description ?? body?.error ?? response.statusText}`,
      body?.error ?? null
    );
  }

  const lifetime = typeof body.expires_in === "number" ? body.expires_in : 3600;
  tokens.set(account.clientEmail, {
    token: body.access_token,
    expiresAt: Date.now() + lifetime * 1000 - TOKEN_SKEW_MS,
  });
  return body.access_token;
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] };
}

async function callPlay(
  path: string,
  init: RequestInit & { method: string }
): Promise<Response> {
  const { serviceAccount } = requirePlayConfig();
  const accessToken = await playAccessToken(serviceAccount);
  const response = await fetch(`${ANDROID_PUBLISHER}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    // A 401 usually means the cached token was invalidated (key rotated, or the
    // service account lost its Play Console grant); drop it so the next attempt
    // mints a fresh one instead of failing identically.
    if (response.status === 401) tokens.delete(serviceAccount.clientEmail);
    const body = (await response.json().catch(() => null)) as GoogleErrorBody | null;
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? null;
    throw new PlayApiError(
      response.status,
      body?.error?.message ?? `Google Play API returned ${response.status}`,
      reason
    );
  }
  return response;
}

/**
 * `purchases.subscriptionsv2.get` — the only statement about a purchase this
 * app trusts. Notifications say that something changed; this says what is true.
 */
export async function getPlaySubscription(
  purchaseToken: string
): Promise<PlaySubscriptionPurchaseV2> {
  const { packageName } = requirePlayConfig();
  const response = await callPlay(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { method: "GET" }
  );
  return (await response.json()) as PlaySubscriptionPurchaseV2;
}

/**
 * `purchases.subscriptions.acknowledge`. Acknowledgement is still a v1 call and
 * still needs the product id, which is why it is taken as an argument rather
 * than read from the token.
 *
 * Google refunds and revokes a purchase that has not been acknowledged within
 * three days, so a failure here is a real problem and not a formality. It is
 * done on the server rather than in the client so that acknowledgement and
 * entitlement cannot disagree: the same call that grants access is the one that
 * confirms it.
 */
export async function acknowledgePlaySubscription(
  productId: string,
  purchaseToken: string
): Promise<void> {
  const { packageName } = requirePlayConfig();
  await callPlay(
    `/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  logger.info("play_purchase_acknowledged", { productId });
}

/**
 * Acknowledges and reports whether it worked, without throwing. Used where the
 * caller has already granted the entitlement and must not fail the request over
 * an acknowledgement that a retry can fix.
 */
export async function tryAcknowledgePlaySubscription(
  productId: string,
  purchaseToken: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await acknowledgePlaySubscription(productId, purchaseToken);
    return { ok: true };
  } catch (error) {
    logger.error("play_acknowledge_failed", { productId, error: serializeError(error) });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
