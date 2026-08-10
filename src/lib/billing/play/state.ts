/**
 * Play subscription state, and what it means for access.
 *
 * Pure functions over the payload shape, so every branch is unit-testable
 * without a Google credential. The two branches worth reading carefully:
 *
 *   In grace period — the renewal payment failed and Google is retrying.
 *   The customer KEEPS access. Their card needs updating, and locking them out
 *   of a finance app while it does is how a recoverable payment problem turns
 *   into a cancellation.
 *
 *   On hold — the retries ran out. The customer LOSES access, and gets it back
 *   without buying anything again if they fix their payment method, at which
 *   point Google sends a recovery notification.
 *
 * Getting those two the wrong way round is the classic Play Billing bug: one
 * direction gives the product away for free, the other locks out a paying
 * customer. They are tested in both directions.
 */

import type { PlanId, SubscriptionStatus } from "@/generated/prisma/client";

import { planForPlayProduct } from "./products";

/* ------------------------------------------------------------------ */
/* Wire shapes                                                         */
/* ------------------------------------------------------------------ */

export interface PlayExternalAccountIdentifiers {
  externalAccountId?: string | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
}

export interface PlayLineItem {
  productId?: string | null;
  expiryTime?: string | null;
  autoRenewingPlan?: { autoRenewEnabled?: boolean | null } | null;
  prepaidPlan?: { allowExtendAfterTime?: string | null } | null;
  offerDetails?: { basePlanId?: string | null; offerId?: string | null } | null;
}

/** The subset of `purchases.subscriptionsv2.get` this app reads. */
export interface PlaySubscriptionPurchaseV2 {
  kind?: string | null;
  regionCode?: string | null;
  latestOrderId?: string | null;
  linkedPurchaseToken?: string | null;
  startTime?: string | null;
  subscriptionState?: string | null;
  acknowledgementState?: string | null;
  externalAccountIdentifiers?: PlayExternalAccountIdentifiers | null;
  lineItems?: PlayLineItem[] | null;
  canceledStateContext?: Record<string, unknown> | null;
  pausedStateContext?: { autoResumeTime?: string | null } | null;
  testPurchase?: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export const PLAY_STATE = {
  unspecified: "SUBSCRIPTION_STATE_UNSPECIFIED",
  /** Purchase awaiting a slow payment method; nothing is paid for yet. */
  pending: "SUBSCRIPTION_STATE_PENDING",
  active: "SUBSCRIPTION_STATE_ACTIVE",
  /** Renewal payment failing, Google retrying. Access continues. */
  inGracePeriod: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  /** Retries exhausted. Access stops until the customer fixes payment. */
  onHold: "SUBSCRIPTION_STATE_ON_HOLD",
  /** Customer paused it deliberately. Access stops for the pause. */
  paused: "SUBSCRIPTION_STATE_PAUSED",
  /** Cancelled but still inside the paid period. Access until expiry. */
  canceled: "SUBSCRIPTION_STATE_CANCELED",
  expired: "SUBSCRIPTION_STATE_EXPIRED",
  pendingPurchaseCanceled: "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
} as const;

export const PLAY_ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";

/** States in which Google considers the subscription to exist and be paid for. */
export const PLAY_ENTITLING_STATES: readonly string[] = [
  PLAY_STATE.active,
  PLAY_STATE.inGracePeriod,
  PLAY_STATE.canceled,
];

/* ------------------------------------------------------------------ */
/* Reading a purchase                                                  */
/* ------------------------------------------------------------------ */

export interface PlayPurchaseFacts {
  productId: string | null;
  basePlanId: string | null;
  /** The tier the product grants, or null if the product id is unknown here. */
  plan: PlanId | null;
  state: string;
  startTime: Date | null;
  expiryTime: Date | null;
  autoRenewing: boolean;
  linkedPurchaseToken: string | null;
  acknowledged: boolean;
  latestOrderId: string | null;
  identifiers: PlayExternalAccountIdentifiers | null;
  isTestPurchase: boolean;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Flattens the payload into the fields this app stores.
 *
 * A subscription purchase carries one line item per product in the purchase.
 * Ballast sells one product per purchase, so the first line item is the whole
 * story; taking it explicitly rather than assuming keeps the read total.
 */
export function readPlayPurchase(purchase: PlaySubscriptionPurchaseV2): PlayPurchaseFacts {
  const line = purchase.lineItems?.[0] ?? null;
  const productId = line?.productId?.trim() || null;
  return {
    productId,
    basePlanId: line?.offerDetails?.basePlanId?.trim() || null,
    plan: productId ? planForPlayProduct(productId) : null,
    state: purchase.subscriptionState?.trim() || PLAY_STATE.unspecified,
    startTime: parseDate(purchase.startTime),
    expiryTime: parseDate(line?.expiryTime),
    // Absent `autoRenewingPlan` means a prepaid plan, which does not renew.
    autoRenewing: line?.autoRenewingPlan?.autoRenewEnabled === true,
    linkedPurchaseToken: purchase.linkedPurchaseToken?.trim() || null,
    acknowledged: purchase.acknowledgementState === PLAY_ACKNOWLEDGED,
    latestOrderId: purchase.latestOrderId?.trim() || null,
    identifiers: purchase.externalAccountIdentifiers ?? null,
    isTestPurchase: Boolean(purchase.testPurchase),
  };
}

/* ------------------------------------------------------------------ */
/* State to entitlement                                                */
/* ------------------------------------------------------------------ */

export interface PlayEntitlement {
  /** Whether this purchase grants its tier right now. */
  entitling: boolean;
  /** The local enum value to cache on the Subscription row. */
  status: SubscriptionStatus;
  /** True once the customer has cancelled but is still inside the paid period. */
  cancelAtPeriodEnd: boolean;
  /** When access ends, as far as Google has said. */
  accessUntil: Date | null;
  /** True once the purchase can never entitle again, so its row can retire. */
  terminal: boolean;
}

export interface PlayEntitlementInput {
  state: string;
  expiryTime: Date | null;
  /** Set for a refund or chargeback, which cuts access at once. */
  revoked?: boolean;
  now?: Date;
}

/**
 * Maps a Play state onto the five-value SubscriptionStatus this app already
 * has, plus the entitlement decision.
 *
 * The local enum has no PAUSED or ON_HOLD, and this change deliberately does
 * not add them: the enum is a cache that gates access, and both of those states
 * gate it shut. Play's own finer-grained state is kept verbatim on the
 * `play_purchases` row, which is where a support question should be answered
 * from.
 */
export function playEntitlement(input: PlayEntitlementInput): PlayEntitlement {
  const now = input.now ?? new Date();
  const { state, expiryTime } = input;
  const unexpired = expiryTime === null || expiryTime.getTime() > now.getTime();

  // A refund or chargeback beats every state: the money went back, so the
  // access goes with it, immediately and not at the end of the period.
  if (input.revoked) {
    return {
      entitling: false,
      status: "CANCELED",
      cancelAtPeriodEnd: false,
      accessUntil: null,
      terminal: true,
    };
  }

  switch (state) {
    case PLAY_STATE.active:
      return {
        entitling: unexpired,
        status: unexpired ? "ACTIVE" : "CANCELED",
        cancelAtPeriodEnd: false,
        accessUntil: expiryTime,
        terminal: false,
      };

    // Keep access. The payment is being retried and most of these recover.
    case PLAY_STATE.inGracePeriod:
      return {
        entitling: unexpired,
        status: unexpired ? "PAST_DUE" : "CANCELED",
        cancelAtPeriodEnd: false,
        accessUntil: expiryTime,
        terminal: false,
      };

    // Cancelled, but paid up until expiry: access continues to the end of the
    // period, and the client shows "ends on <date>" rather than "cancelled".
    case PLAY_STATE.canceled:
      return {
        entitling: unexpired,
        status: unexpired ? "ACTIVE" : "CANCELED",
        cancelAtPeriodEnd: true,
        accessUntil: expiryTime,
        terminal: !unexpired,
      };

    // Cut access, but not terminal: fixing the payment method restores it
    // without a new purchase, and Google sends a recovery notification.
    case PLAY_STATE.onHold:
      return {
        entitling: false,
        status: "INCOMPLETE",
        cancelAtPeriodEnd: false,
        accessUntil: null,
        terminal: false,
      };

    // Deliberately paused by the customer; resumes on its own.
    case PLAY_STATE.paused:
      return {
        entitling: false,
        status: "CANCELED",
        cancelAtPeriodEnd: false,
        accessUntil: null,
        terminal: false,
      };

    // Nothing has been paid yet. Not an entitlement, and not a failure either.
    case PLAY_STATE.pending:
      return {
        entitling: false,
        status: "INCOMPLETE",
        cancelAtPeriodEnd: false,
        accessUntil: null,
        terminal: false,
      };

    case PLAY_STATE.expired:
    case PLAY_STATE.pendingPurchaseCanceled:
      return {
        entitling: false,
        status: "CANCELED",
        cancelAtPeriodEnd: false,
        accessUntil: null,
        terminal: true,
      };

    default:
      // An unknown state grants nothing. Google adding a state must not hand
      // out entitlements this build has never heard of.
      return {
        entitling: false,
        status: "INCOMPLETE",
        cancelAtPeriodEnd: false,
        accessUntil: null,
        terminal: false,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Real-time developer notifications                                   */
/* ------------------------------------------------------------------ */

/**
 * `subscriptionNotification.notificationType` values.
 * https://developer.android.com/google/play/billing/rtdn-reference
 */
export const PLAY_NOTIFICATION = {
  recovered: 1,
  renewed: 2,
  canceled: 3,
  purchased: 4,
  onHold: 5,
  inGracePeriod: 6,
  restarted: 7,
  priceChangeConfirmed: 8,
  deferred: 9,
  paused: 10,
  pauseScheduleChanged: 11,
  revoked: 12,
  expired: 13,
  pendingPurchaseCanceled: 20,
} as const;

const NOTIFICATION_NAMES: Record<number, string> = {
  1: "SUBSCRIPTION_RECOVERED",
  2: "SUBSCRIPTION_RENEWED",
  3: "SUBSCRIPTION_CANCELED",
  4: "SUBSCRIPTION_PURCHASED",
  5: "SUBSCRIPTION_ON_HOLD",
  6: "SUBSCRIPTION_IN_GRACE_PERIOD",
  7: "SUBSCRIPTION_RESTARTED",
  8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
  9: "SUBSCRIPTION_DEFERRED",
  10: "SUBSCRIPTION_PAUSED",
  11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
  12: "SUBSCRIPTION_REVOKED",
  13: "SUBSCRIPTION_EXPIRED",
  20: "SUBSCRIPTION_PENDING_PURCHASE_CANCELED",
};

/** A readable name for logs and the audit trail; unknown types keep the number. */
export function playNotificationName(type: number): string {
  return NOTIFICATION_NAMES[type] ?? `SUBSCRIPTION_NOTIFICATION_${type}`;
}

/**
 * Whether this notification means the money went back to the customer.
 *
 * A revocation is the one case where the notification type itself decides
 * something the subscription state cannot: `subscriptionsv2.get` reports a
 * revoked purchase as expired, which is indistinguishable from a subscription
 * that simply ran its course. Everything else about the purchase is still
 * re-read from Google rather than taken from the notification.
 */
export function playNotificationRevokes(type: number): boolean {
  return type === PLAY_NOTIFICATION.revoked;
}
