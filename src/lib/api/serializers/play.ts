import "server-only";

import type { PlanSource } from "@/lib/api/serializers/billing";
import { timestampOrNull } from "@/lib/api/wire";
import type { TimestampString } from "@/lib/api/wire";
import type { Entitlements } from "@/lib/billing/entitlements";
import { isPlayBillingConfigured, playPackageName } from "@/lib/billing/play/config";
import { playIdentity } from "@/lib/billing/play/identity";
import { playManagementUrl, playProductsForEdition } from "@/lib/billing/play/products";
import { getPlan, type PlanId } from "@/lib/billing/plans";

/**
 * The Google Play half of `GET /api/billing/summary`.
 *
 * Everything an Android client needs to draw a plan screen and launch a billing
 * flow, in one place: which products to look up in `ProductDetails`, the two
 * obfuscated identifiers to attach to the flow, whether buying is allowed at all,
 * and where to send someone to manage what they already have.
 */

export interface SerializedPlayOffer {
  /** Pass to `queryProductDetailsAsync`. */
  productId: string;
  basePlanId: string;
  planId: PlanId;
  planName: string;
}

export interface SerializedPlaySubscription {
  productId: string;
  basePlanId: string | null;
  /** Play's own `subscriptionState` string. */
  state: string;
  expiresAt: TimestampString | null;
  autoRenewing: boolean;
  acknowledged: boolean;
  /** Whether this purchase is what currently grants the workspace its plan. */
  entitling: boolean;
}

export interface SerializedPlayBlock {
  /** False means this server has no Play credentials, so verification would 503. */
  configured: boolean;
  packageName: string | null;
  /**
   * The values to set as `obfuscatedAccountId` and `obfuscatedProfileId` when
   * launching the billing flow. Supplied ready-made so a client never has to
   * reimplement the hashing, and so the server can reject a purchase whose
   * identifiers do not match.
   */
  obfuscatedAccountId: string | null;
  obfuscatedProfileId: string | null;
  /** The products this workspace's edition may be offered. */
  products: SerializedPlayOffer[];
  /** The workspace's Play subscription, if it has one. */
  subscription: SerializedPlaySubscription | null;
}

export function serializePlayBlock(
  entitlements: Entitlements,
  userId: string,
  workspaceId: string
): SerializedPlayBlock {
  const configured = isPlayBillingConfigured();
  const packageName = playPackageName();
  const identity = playIdentity(userId, workspaceId);
  const play = entitlements.play;

  return {
    configured,
    packageName,
    obfuscatedAccountId: identity.obfuscatedAccountId,
    obfuscatedProfileId: identity.obfuscatedProfileId,
    products: playProductsForEdition(entitlements.edition).map((product) => ({
      productId: product.productId,
      basePlanId: product.basePlanId,
      planId: product.planId,
      planName: getPlan(product.planId, entitlements.edition).name,
    })),
    subscription: play
      ? {
          productId: play.productId,
          basePlanId: play.basePlanId,
          state: play.state,
          expiresAt: timestampOrNull(play.expiryTime),
          autoRenewing: play.autoRenewing,
          acknowledged: play.acknowledged,
          entitling: play.entitling,
        }
      : null,
  };
}

/** Why in-app purchase is unavailable, when it is. */
export type PurchaseBlockedReason =
  /** Stripe is already paying for this workspace. Charging again owes a refund. */
  | "MANAGED_ON_WEB"
  /** The plan is a complimentary grant; there is nothing to buy. */
  | "COMPLIMENTARY"
  /** This server has no Play credentials. */
  | "PLAY_NOT_CONFIGURED"
  /** The edition sells nothing through Play. */
  | "NO_PRODUCTS";

export interface SerializedBillingManagement {
  /** Where the current plan is paid for. */
  source: PlanSource;
  /**
   * Whether the client may show purchase buttons at all.
   *
   * The case this exists for: a customer already paying through Stripe on the
   * web installs the Android app. If they can tap upgrade they are charged twice
   * and somebody owes them a refund and an apology, so the server says plainly
   * that buying is not available and why.
   */
  canPurchaseInApp: boolean;
  blockedReason: PurchaseBlockedReason | null;
  /**
   * True when `POST /api/billing/portal` will return a Stripe Billing Portal
   * URL. That is the management affordance for a Stripe customer.
   */
  portalAvailable: boolean;
  /** Google Play's subscription page for this product, for a Play customer. */
  playManageUrl: string | null;
}

export function serializeBillingManagement(
  entitlements: Entitlements,
  play: SerializedPlayBlock,
  stripeConfigured: boolean,
  source: PlanSource
): SerializedBillingManagement {
  const blockedReason: PurchaseBlockedReason | null = !play.configured
    ? "PLAY_NOT_CONFIGURED"
    : play.products.length === 0
      ? "NO_PRODUCTS"
      : source === "complimentary"
        ? "COMPLIMENTARY"
        : entitlements.hasActiveStripeSubscription
          ? "MANAGED_ON_WEB"
          : null;

  return {
    source,
    canPurchaseInApp: blockedReason === null,
    blockedReason,
    // A complimentary account gets neither affordance: there is no Stripe
    // customer behind the grant and no Play purchase to manage.
    portalAvailable:
      source !== "complimentary" && stripeConfigured && entitlements.hasStripeCustomer,
    playManageUrl:
      source === "google_play" && play.subscription && play.packageName
        ? playManagementUrl(play.subscription.productId, play.packageName)
        : null,
  };
}
