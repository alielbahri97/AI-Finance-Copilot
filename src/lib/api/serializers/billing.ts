/**
 * Wire shaping for the plan and quota state, shared by
 * `GET /api/session/bootstrap` and `GET /api/billing/summary`.
 *
 * Plan prices are the one place a figure in euros stays a JSON number. A price
 * list is a constant compiled into the app, not an amount that was added to
 * anything, so it never enters money arithmetic — and `monthlyPriceEur` already
 * ships to the web client as a number. `monthlyPrice` carries the same value as
 * a money string for clients that would rather have one shape for every amount.
 */

import { moneyOrNull, timestampOrNull } from "@/lib/api/wire";
import type { MoneyString, TimestampString } from "@/lib/api/wire";
import type { Entitlements, Usage } from "@/lib/billing/entitlements";
import { overriddenPlanForEmail } from "@/lib/billing/plan-overrides";
import type { Plan, PlanId, PlanLimits } from "@/lib/billing/plans";
import type { PlanSource as StoredPlanSource } from "@/generated/prisma/client";
import type { Edition } from "@/lib/branding";

/**
 * Where the workspace's current plan comes from.
 *
 * `google_play` became real with Play Billing: it is what a workspace paid for
 * inside the Android app reports, and it decides which management affordance a
 * client should offer — the Stripe Billing Portal, a Play deep link, or nothing
 * at all for a complimentary account.
 */
export type PlanSource = "stripe" | "google_play" | "complimentary" | "trial" | "free";

/** The stored enum, as the wire spells it. */
const PLAN_SOURCE_WIRE: Record<StoredPlanSource, PlanSource> = {
  FREE: "free",
  TRIAL: "trial",
  COMPLIMENTARY: "complimentary",
  STRIPE: "stripe",
  GOOGLE_PLAY: "google_play",
};

export function planSourceToWire(source: StoredPlanSource): PlanSource {
  return PLAN_SOURCE_WIRE[source];
}

export interface PlanSourceInput {
  /** Email of the workspace OWNER, which is what a complimentary grant keys on. */
  ownerEmail: string | null | undefined;
  edition: Edition;
  planId: PlanId;
  /** Present only once Stripe has actually created a subscription. */
  stripeSubscriptionId: string | null | undefined;
  isTrial: boolean;
  /**
   * What the entitlements resolver decided, when the caller has it. It knows
   * about Google Play, which none of the other inputs can see. The Stripe/trial
   * heuristics below remain for callers that only hold a Subscription row.
   */
  resolvedSource?: StoredPlanSource | null;
}

export function resolvePlanSource(input: PlanSourceInput): PlanSource {
  if (overriddenPlanForEmail(input.ownerEmail, input.edition)) return "complimentary";
  const resolved = input.resolvedSource ? PLAN_SOURCE_WIRE[input.resolvedSource] : null;
  // A paying source is authoritative. "free" and "trial" fall through to the
  // heuristics so a caller passing a resolver result and a caller passing none
  // agree on those two.
  if (resolved && resolved !== "free" && resolved !== "trial") return resolved;
  if (input.stripeSubscriptionId && input.planId !== "FREE") return "stripe";
  if (input.isTrial) return "trial";
  return "free";
}

/**
 * Which prices a client should show.
 *
 * `eur_list` means the `monthlyPrice` figures in `plans` are what this customer
 * pays. `google_play` means they are not: Google converts a base price per
 * country and applies its own rounding and tax rules, so the amount a Play
 * subscriber is charged is only knowable from Play's `ProductDetails` on the
 * device. The server never asserts an expected amount, and this field says so
 * out loud rather than leaving a client to infer it.
 */
export type PriceSource = "eur_list" | "google_play";

export interface SerializedEntitlements {
  planId: PlanId;
  planName: string;
  edition: Edition;
  workspaceType: string;
  limits: PlanLimits;
  usage: Usage;
  isTrial: boolean;
  trialEndsAt: TimestampString | null;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: TimestampString | null;
  hasStripeCustomer: boolean;
  /** Calendar month the usage counters belong to, "YYYY-MM". */
  period: string;
}

/**
 * The entitlements object with its two dates normalized. Limits and counters
 * stay numbers: they are quotas, not amounts.
 */
export function serializeEntitlements(entitlements: Entitlements): SerializedEntitlements {
  return {
    planId: entitlements.planId,
    planName: entitlements.plan.name,
    edition: entitlements.edition,
    workspaceType: entitlements.workspaceType,
    limits: entitlements.plan.limits,
    usage: entitlements.usage,
    isTrial: entitlements.isTrial,
    trialEndsAt: timestampOrNull(entitlements.trialEndsAt),
    subscriptionStatus: entitlements.subscriptionStatus,
    cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
    currentPeriodEnd: timestampOrNull(entitlements.currentPeriodEnd),
    hasStripeCustomer: entitlements.hasStripeCustomer,
    period: entitlements.period,
  };
}

export interface SerializedPlan {
  id: PlanId;
  edition: Edition;
  name: string;
  description: string;
  /** EUR per month; 0 = free, null = contact sales. A price-list figure. */
  monthlyPriceEur: number | null;
  /** The same figure as a money string, or null for contact-sales. */
  monthlyPrice: MoneyString | null;
  limits: PlanLimits;
  highlights: string[];
}

export function serializePlan(plan: Plan): SerializedPlan {
  return {
    id: plan.id,
    edition: plan.edition,
    name: plan.name,
    description: plan.description,
    monthlyPriceEur: plan.monthlyPriceEur,
    monthlyPrice: moneyOrNull(plan.monthlyPriceEur),
    limits: plan.limits,
    highlights: plan.highlights,
  };
}

/** One quota meter. `limit: null` means unlimited; `0` means the plan has none. */
export interface UsageMeter {
  used: number;
  limit: number | null;
}

export interface SerializedUsageMeters {
  aiMessages: UsageMeter;
  aiCategorizations: UsageMeter;
  csvImports: UsageMeter;
  /**
   * Always present, and always `{used: 0, limit: 0}` in the Personal edition,
   * which has no invoices. The billing page hides a zero-limit meter rather
   * than showing "0 / 0"; a client should do the same.
   */
  invoiceExtractions: UsageMeter;
  /** Excel/PDF exports. CSV is free on every plan and is not metered. */
  exports: UsageMeter;
}

export function serializeUsageMeters(entitlements: Entitlements): SerializedUsageMeters {
  const { usage, plan } = entitlements;
  return {
    aiMessages: { used: usage.aiMessages, limit: plan.limits.aiMessagesPerMonth },
    aiCategorizations: {
      used: usage.aiCategorizations,
      limit: plan.limits.aiCategorizationPerMonth,
    },
    csvImports: { used: usage.csvImports, limit: plan.limits.csvImportsPerMonth },
    invoiceExtractions: {
      used: usage.invoiceExtractions,
      limit: plan.limits.invoiceExtractionsPerMonth,
    },
    exports: { used: usage.exports, limit: plan.limits.exportsEnabled ? null : 0 },
  };
}
