/**
 * The Play product catalogue, and the mapping between a Play product id and the
 * tier it grants.
 *
 * Four auto-renewing subscription products, one monthly base plan each. Business
 * Enterprise is deliberately absent: it is contact-sales with a null price, so
 * there is nothing for Play to charge and no product to create.
 *
 * Two things are *not* here, on purpose:
 *
 *   Prices. Google converts a base price into every country's currency and
 *   applies its own rounding and tax handling, so the euro figures in plans.ts
 *   are a price list for the web, not a statement about what a Play customer
 *   was charged. The Android client renders prices from Play's own
 *   ProductDetails, and nothing on the server ever asserts an expected amount
 *   when validating a purchase.
 *
 *   Free-trial offers. The app already grants a local 14-day trial at signup,
 *   before any purchase exists. A Play trial offer on top would mean two
 *   independent sources of trial state that can disagree, so the products carry
 *   no offers and the local trial is left exactly as it was.
 */

import type { Edition } from "@/lib/branding";

import { EDITION_CHECKOUT_PLANS, type PlanId } from "../plans";

export interface PlayProduct {
  /** Play subscription product id, created by hand in Play Console. */
  productId: string;
  /** The single monthly base plan inside it. */
  basePlanId: string;
  /** The tier a purchase of it grants. */
  planId: PlanId;
  /** The edition whose workspaces may be offered it. */
  edition: Edition;
}

export const PLAY_PRODUCTS: readonly PlayProduct[] = [
  {
    productId: "business_pro",
    basePlanId: "business-pro-monthly",
    planId: "PRO",
    edition: "business",
  },
  {
    productId: "business_team",
    basePlanId: "business-team-monthly",
    planId: "BUSINESS",
    edition: "business",
  },
  {
    productId: "personal_plus",
    basePlanId: "personal-plus-monthly",
    planId: "PLUS",
    edition: "personal",
  },
  {
    productId: "personal_premium",
    basePlanId: "personal-premium-monthly",
    planId: "PREMIUM",
    edition: "personal",
  },
];

/**
 * The products a workspace of this edition may be offered, mirroring
 * `checkoutPlans(edition)` so a personal workspace can never be shown — or
 * charged for — a business plan.
 */
export function playProductsForEdition(edition: Edition): PlayProduct[] {
  const sellable = new Set<PlanId>(EDITION_CHECKOUT_PLANS[edition]);
  return PLAY_PRODUCTS.filter(
    (product) => product.edition === edition && sellable.has(product.planId)
  );
}

/** The product for a tier, or null where the edition does not sell one. */
export function playProductForPlan(planId: PlanId, edition: Edition): PlayProduct | null {
  return playProductsForEdition(edition).find((product) => product.planId === planId) ?? null;
}

/** The product record for a Play product id, or null if it is not one of ours. */
export function playProductById(productId: string): PlayProduct | null {
  return PLAY_PRODUCTS.find((product) => product.productId === productId) ?? null;
}

/**
 * The tier a Play product grants, or null for an unknown id.
 *
 * An unknown product id is not a tier we can guess at: it means Play Console
 * has a product this build does not know about, and granting something on a
 * guess is worse than granting nothing and logging it.
 */
export function planForPlayProduct(productId: string): PlanId | null {
  return playProductById(productId)?.planId ?? null;
}

/** True when this product belongs to the edition's line-up. */
export function playProductAllowedForEdition(productId: string, edition: Edition): boolean {
  return playProductsForEdition(edition).some((product) => product.productId === productId);
}

/**
 * Where a Play subscriber manages or cancels their subscription. There is no
 * server-side cancellation API for Play, so this deep link is the whole of the
 * management affordance the client can offer.
 */
export function playManagementUrl(productId: string, packageName: string): string {
  const params = new URLSearchParams({ sku: productId, package: packageName });
  return `https://play.google.com/store/account/subscriptions?${params.toString()}`;
}
