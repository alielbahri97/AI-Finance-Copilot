/**
 * Entitlement resolution across every possible payer.
 *
 * A workspace can be paid for on the web through Stripe, on a phone through
 * Google Play, granted complimentary access by email, or running the local
 * card-free trial. This module decides which one wins, and is deliberately pure:
 * no database, no clock of its own, no I/O.
 *
 * The order, highest priority first:
 *
 *   1. The complimentary email override. Unconditional.
 *   2. Whichever of Stripe and Google Play grants the HIGHER TIER while in an
 *      entitling state.
 *   3. The local 14-day trial.
 *   4. Free.
 *
 * Step 2 compares tier rank, not recency, and that is the important part. "Most
 * recent wins" looks reasonable until webhooks arrive out of order — which they
 * do, routinely, because Stripe and Google retry independently and neither
 * knows about the other — and then a stale Play notification about last month's
 * expiry silently downgrades a customer who upgraded on the web an hour ago.
 * Rank-based resolution cannot do that: the worst an out-of-order event can do
 * is fail to *raise* a tier, which the next read of either source corrects.
 *
 * The Subscription row remains the resolved cache. Stripe's own columns and the
 * play_purchases rows are the two sources of truth, and neither is overwritten
 * by the cache.
 */

import type { PlanId, PlanSource, Subscription, SubscriptionStatus } from "@/generated/prisma/client";
import { DEFAULT_EDITION, type Edition } from "@/lib/branding";

import { EDITION_PLAN_ORDER, trialPlan } from "./plans";

/**
 * Tier rank within an edition, low to high. The two ladders line up rung for
 * rung — Free/Plus/Premium against Free/Pro/Business/Enterprise — so ranks from
 * different editions are still comparable, which matters only for a workspace
 * holding a tier its edition does not sell.
 */
const CROSS_EDITION_RANK: Record<PlanId, number> = {
  FREE: 0,
  PLUS: 1,
  PRO: 1,
  PREMIUM: 2,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

export function tierRank(planId: PlanId, edition: Edition = DEFAULT_EDITION): number {
  const index = EDITION_PLAN_ORDER[edition].indexOf(planId);
  return index >= 0 ? index : CROSS_EDITION_RANK[planId];
}

/** True when `a` is a strictly higher tier than `b` in this edition. */
export function isHigherTier(a: PlanId, b: PlanId, edition: Edition = DEFAULT_EDITION): boolean {
  return tierRank(a, edition) > tierRank(b, edition);
}

/** Stripe statuses that keep a customer's access. PAST_DUE is Stripe's grace. */
export const STRIPE_ENTITLING_STATUSES: readonly SubscriptionStatus[] = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
];

/** One payer's claim on the workspace, as the resolver sees it. */
export interface PlanCandidate {
  source: PlanSource;
  planId: PlanId;
  /** Whether this payer is entitling right now. */
  entitling: boolean;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /** End of the paid period, where the payer knows one. */
  currentPeriodEnd: Date | null;
}

/** What Google Play currently says, already reduced by `playEntitlement`. */
export interface PlayCandidateInput {
  planId: PlanId;
  entitling: boolean;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  accessUntil: Date | null;
}

export interface ResolveEntitlementInput {
  /** The resolved cache row, which also carries Stripe's columns and the trial. */
  subscription: SubscriptionLike;
  /**
   * The workspace's live Play purchases, retired rows already excluded.
   *
   * Absent and present-but-empty mean different things. An array — including an
   * empty one — is a statement that Play has been consulted and this is all it
   * has. `undefined` means it has not been consulted, and the cache row stands
   * in for it, which is what lets the admin revenue roll-up resolve a hundred
   * rows without a query per workspace.
   */
  play?: PlayCandidateInput[];
  /**
   * The complimentary grant for the workspace owner. Same convention: `null` is
   * "checked, no grant", `undefined` is "not checked, trust the cache". Without
   * the distinction, removing an address from the allowlist would leave the
   * grant frozen into the cache forever.
   */
  overridePlanId?: PlanId | null;
  edition?: Edition;
  now?: Date;
}

/**
 * The fields resolution reads. Spelled out rather than taking the whole model so
 * that a caller with a `select` can satisfy it, and so adding a column to
 * Subscription does not silently widen what resolution depends on.
 */
export type SubscriptionLike = Pick<
  Subscription,
  | "plan"
  | "status"
  | "planSource"
  | "stripeSubscriptionId"
  | "stripePlan"
  | "stripeStatus"
  | "currentPeriodEnd"
  | "cancelAtPeriodEnd"
  | "trialEndsAt"
>;

export interface ResolvedEntitlement {
  planId: PlanId;
  /** True for the local card-free trial and for a Stripe trial. */
  isTrial: boolean;
  source: PlanSource;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** Every payer that was considered, for the billing screen and for tests. */
  candidates: PlanCandidate[];
}

/**
 * Stripe's tier and status.
 *
 * `stripePlan` and `stripeStatus` were added with Play billing; rows written
 * before that carry Stripe's answer in the shared `plan`/`status` columns, which
 * is what the fallback reads. The fallback is skipped when the cache was last
 * written by Google Play or by a complimentary grant, because then those columns
 * are somebody else's answer and reading them as Stripe's would invent a web
 * subscription that does not exist.
 */
export function stripeCandidate(subscription: SubscriptionLike): PlanCandidate | null {
  const cacheIsStripes =
    subscription.planSource !== "GOOGLE_PLAY" && subscription.planSource !== "COMPLIMENTARY";
  const planId = subscription.stripePlan ?? (cacheIsStripes ? subscription.plan : null);
  const status = subscription.stripeStatus ?? (cacheIsStripes ? subscription.status : null);
  if (!planId || !status) return null;
  if (planId === "FREE") return null;

  return {
    source: "STRIPE",
    planId,
    entitling: STRIPE_ENTITLING_STATUSES.includes(status),
    status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}

function playCandidates(play: PlayCandidateInput[]): PlanCandidate[] {
  return play.map((entry) => ({
    source: "GOOGLE_PLAY" as PlanSource,
    planId: entry.planId,
    entitling: entry.entitling,
    status: entry.status,
    cancelAtPeriodEnd: entry.cancelAtPeriodEnd,
    currentPeriodEnd: entry.accessUntil,
  }));
}

/**
 * The cache row read as a candidate of whatever source last wrote it. Used only
 * for the source that was not consulted, so a caller who did consult Play or the
 * allowlist never has a stale cache competing with the live answer.
 */
function cachedCandidate(subscription: SubscriptionLike, source: PlanSource): PlanCandidate | null {
  if (subscription.planSource !== source) return null;
  if (subscription.plan === "FREE") return null;
  return {
    source,
    planId: subscription.plan,
    entitling: STRIPE_ENTITLING_STATUSES.includes(subscription.status),
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}

/**
 * Picks the winner among the paying sources: highest tier first, and on a tie
 * the one whose paid period runs longest, so a customer who is somehow paying
 * both ways keeps the later end date on their billing screen.
 */
function bestPayingCandidate(
  candidates: PlanCandidate[],
  edition: Edition
): PlanCandidate | null {
  let best: PlanCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.entitling || candidate.planId === "FREE") continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const rank = tierRank(candidate.planId, edition);
    const bestRank = tierRank(best.planId, edition);
    if (rank > bestRank) {
      best = candidate;
      continue;
    }
    if (rank === bestRank) {
      const end = candidate.currentPeriodEnd?.getTime() ?? 0;
      const bestEnd = best.currentPeriodEnd?.getTime() ?? 0;
      if (end > bestEnd) best = candidate;
    }
  }
  return best;
}

function asList<T>(value: T | null): T[] {
  return value === null ? [] : [value];
}

/** The cache row as a Play candidate, for a caller that did not query Play. */
function cachedCandidateInput(subscription: SubscriptionLike): PlayCandidateInput | null {
  const cached = cachedCandidate(subscription, "GOOGLE_PLAY");
  if (!cached) return null;
  return {
    planId: cached.planId,
    entitling: cached.entitling,
    status: cached.status,
    cancelAtPeriodEnd: cached.cancelAtPeriodEnd,
    accessUntil: cached.currentPeriodEnd,
  };
}

/**
 * The resolver. Returns the effective plan, which payer it came from, and every
 * candidate that was considered.
 */
export function resolveEntitlement(input: ResolveEntitlementInput): ResolvedEntitlement {
  const edition = input.edition ?? DEFAULT_EDITION;
  const now = input.now ?? new Date();
  const { subscription } = input;

  const stripe = stripeCandidate(subscription);
  const play = input.play ?? asList(cachedCandidateInput(subscription));
  const candidates = [...(stripe ? [stripe] : []), ...playCandidates(play)];

  // 1. The complimentary grant, which is unconditional. The candidates are
  //    still reported: a real paid subscription underneath has to remain
  //    visible, or removing an address from the allowlist looks like it
  //    cancelled the customer's subscription.
  const override =
    input.overridePlanId === undefined
      ? (cachedCandidate(subscription, "COMPLIMENTARY")?.planId ?? null)
      : input.overridePlanId;
  if (override) {
    return {
      planId: override,
      isTrial: false,
      source: "COMPLIMENTARY",
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      candidates,
    };
  }

  // 2. Stripe or Play, by tier rank.
  const paying = bestPayingCandidate(candidates, edition);
  if (paying) {
    return {
      planId: paying.planId,
      isTrial: paying.status === "TRIALING",
      source: paying.source,
      status: paying.status,
      cancelAtPeriodEnd: paying.cancelAtPeriodEnd,
      currentPeriodEnd: paying.currentPeriodEnd,
      candidates,
    };
  }

  // 3. The local trial, untouched by any of this.
  if (subscription.trialEndsAt && subscription.trialEndsAt > now) {
    return {
      planId: trialPlan(edition),
      isTrial: true,
      source: "TRIAL",
      status: "TRIALING",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      candidates,
    };
  }

  // 4. Free. `status` keeps whatever the cache says so a client can still tell
  //    "never paid" from "was paying, then it lapsed".
  return {
    planId: "FREE",
    isTrial: false,
    source: "FREE",
    status: subscription.status,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    candidates,
  };
}

/** True when Stripe is currently paying for this workspace. */
export function hasEntitlingStripeSubscription(subscription: SubscriptionLike): boolean {
  if (!subscription.stripeSubscriptionId) return false;
  return Boolean(stripeCandidate(subscription)?.entitling);
}
