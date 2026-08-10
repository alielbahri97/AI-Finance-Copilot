import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { logger } from "@/lib/logger";

import { playPubsubAudience, playPubsubServiceAccountEmail } from "./config";
import { PLAY_NOTIFICATION, playNotificationRevokes } from "./state";

/**
 * Receiving Real-time Developer Notifications, which arrive as Google Cloud
 * Pub/Sub push messages.
 *
 * This endpoint is public — Google will not present a Ballast session — so the
 * authenticity check *is* the access control. Pub/Sub can be configured to sign
 * each push with an OIDC token; that token's signature, issuer and audience are
 * what distinguishes a real notification from anyone on the internet posting a
 * "your subscription renewed" message. Without it, a stranger could grant
 * themselves a plan by inventing a payload.
 *
 * The payload is then used only to learn *which* purchase token changed. What
 * changed about it is re-read from `purchases.subscriptionsv2.get`, per Google's
 * guidance: https://developer.android.com/google/play/billing/lifecycle
 */

/** Where Google publishes the keys its OIDC tokens are signed with. */
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Both spellings Google uses for the issuer of an ID token. */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/* ------------------------------------------------------------------ */
/* Push authentication                                                 */
/* ------------------------------------------------------------------ */

export type PushAuthFailure =
  | "not_configured"
  | "missing_token"
  | "invalid_token"
  | "wrong_audience"
  | "wrong_issuer"
  | "wrong_service_account"
  | "unverified_email";

export type PushAuthResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: PushAuthFailure };

let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

function googleKeySet(): ReturnType<typeof createRemoteJWKSet> {
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }
  return keySet;
}

/** Test seam: drops the cached Google key set. */
export function resetGooglePushKeyCache(): void {
  keySet = null;
}

/**
 * Verifies the OIDC token on a Pub/Sub push.
 *
 * The audience must equal what the push subscription was configured with, which
 * is the check that stops a token minted for some other service on the same
 * Google Cloud project from being replayed here.
 */
export async function verifyPubsubPush(
  authorizationHeader: string | null | undefined
): Promise<PushAuthResult> {
  const audience = playPubsubAudience();
  if (!audience) return { ok: false, reason: "not_configured" };

  const header = authorizationHeader?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { ok: false, reason: "missing_token" };

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(match[1], googleKeySet(), {
      audience,
      issuer: GOOGLE_ISSUERS,
      algorithms: ["RS256", "ES256"],
      clockTolerance: 5,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const claim = (error as { claim?: string } | null)?.claim;
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "aud") {
      return { ok: false, reason: "wrong_audience" };
    }
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "iss") {
      return { ok: false, reason: "wrong_issuer" };
    }
    return { ok: false, reason: "invalid_token" };
  }

  const email = typeof payload.email === "string" ? payload.email : null;
  const expected = playPubsubServiceAccountEmail();
  if (expected) {
    if (payload.email_verified === false) return { ok: false, reason: "unverified_email" };
    if (email !== expected) return { ok: false, reason: "wrong_service_account" };
  }
  return { ok: true, email };
}

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

export interface SubscriptionNotification {
  version?: string;
  notificationType?: number;
  purchaseToken?: string;
  subscriptionId?: string;
}

export interface VoidedPurchaseNotification {
  purchaseToken?: string;
  orderId?: string;
  /** 1 = one-time product, 2 = subscription. */
  productType?: number;
  /** 1 = full refund, 2 = partial refund. */
  refundType?: number;
}

export interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: SubscriptionNotification;
  voidedPurchaseNotification?: VoidedPurchaseNotification;
  oneTimeProductNotification?: Record<string, unknown>;
  testNotification?: Record<string, unknown>;
}

export interface PubsubEnvelope {
  messageId: string | null;
  publishTime: string | null;
  notification: DeveloperNotification;
}

/**
 * Unwraps the Pub/Sub push envelope. The developer notification is base64 inside
 * `message.data`; anything that is not a decodable JSON object is rejected
 * rather than guessed at.
 */
export function parsePubsubEnvelope(body: unknown): PubsubEnvelope | null {
  if (typeof body !== "object" || body === null) return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;

  const { data, messageId, message_id, publishTime, publish_time } = message as Record<
    string,
    unknown
  >;
  if (typeof data !== "string" || data.length === 0) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(data, "base64").toString("utf8");
  } catch {
    return null;
  }

  let notification: unknown;
  try {
    notification = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof notification !== "object" || notification === null) return null;

  return {
    messageId:
      typeof messageId === "string" ? messageId : typeof message_id === "string" ? message_id : null,
    publishTime:
      typeof publishTime === "string"
        ? publishTime
        : typeof publish_time === "string"
          ? publish_time
          : null,
    notification: notification as DeveloperNotification,
  };
}

export type PlayNotificationKind =
  /** A subscription lifecycle event. */
  | {
      kind: "subscription";
      purchaseToken: string;
      notificationType: number;
      productId: string | null;
      /** True for SUBSCRIPTION_REVOKED: a refund, so access stops immediately. */
      revoked: boolean;
    }
  /** A refund or chargeback against a subscription purchase. */
  | { kind: "voided"; purchaseToken: string; refundType: number | null }
  /** The "test" button in Play Console. Acknowledged and ignored. */
  | { kind: "test" }
  /** Something this app does not sell, or a malformed payload. */
  | { kind: "ignored"; reason: string };

/** Product type 2 on a voided-purchase notification means "subscription". */
const VOIDED_PRODUCT_TYPE_SUBSCRIPTION = 2;

/**
 * Decides what a developer notification is about.
 *
 * Voided purchases are handled as well as the lifecycle types because they are
 * the only signal for a chargeback, which arrives long after the fact and has to
 * cut access the moment it does.
 */
export function classifyDeveloperNotification(
  notification: DeveloperNotification
): PlayNotificationKind {
  if (notification.testNotification) return { kind: "test" };

  const voided = notification.voidedPurchaseNotification;
  if (voided?.purchaseToken) {
    // A one-time product refund cannot affect a subscription entitlement, and
    // this app sells no one-time products.
    if (
      voided.productType !== undefined &&
      voided.productType !== VOIDED_PRODUCT_TYPE_SUBSCRIPTION
    ) {
      return { kind: "ignored", reason: "voided_one_time_product" };
    }
    return {
      kind: "voided",
      purchaseToken: voided.purchaseToken,
      refundType: typeof voided.refundType === "number" ? voided.refundType : null,
    };
  }

  const subscription = notification.subscriptionNotification;
  if (subscription?.purchaseToken && typeof subscription.notificationType === "number") {
    return {
      kind: "subscription",
      purchaseToken: subscription.purchaseToken,
      notificationType: subscription.notificationType,
      productId: subscription.subscriptionId?.trim() || null,
      revoked: playNotificationRevokes(subscription.notificationType),
    };
  }

  if (notification.oneTimeProductNotification) {
    return { kind: "ignored", reason: "one_time_product" };
  }
  return { kind: "ignored", reason: "no_recognised_payload" };
}

/**
 * Whether the package name on the notification is the app this server bills for.
 * A mismatch means the Pub/Sub topic is shared with another application, which
 * is worth knowing about but is not an attack — the OIDC token already proved
 * where the message came from.
 */
export function notificationPackageMatches(
  notification: DeveloperNotification,
  packageName: string | null
): boolean {
  if (!packageName || !notification.packageName) return true;
  return notification.packageName === packageName;
}

/** Every notification type that means "the subscription no longer entitles". */
export const PLAY_ACCESS_ENDING_NOTIFICATIONS: readonly number[] = [
  PLAY_NOTIFICATION.onHold,
  PLAY_NOTIFICATION.paused,
  PLAY_NOTIFICATION.revoked,
  PLAY_NOTIFICATION.expired,
  PLAY_NOTIFICATION.pendingPurchaseCanceled,
];

export function logNotification(
  kind: PlayNotificationKind,
  extra: Record<string, unknown> = {}
): void {
  logger.info("play_notification_received", { kind: kind.kind, ...extra });
}
