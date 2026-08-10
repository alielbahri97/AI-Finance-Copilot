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
import type { Edition } from "@/lib/branding";

/**
 * Where the workspace's current plan comes from.
 *
 * `google_play` is part of the union so a client can switch on it from the
 * first release, but nothing returns it yet: there is no Play Billing
 * integration in this codebase, and inventing a heuristic for one would be a
 * guess a client would then depend on.
 */
export type PlanSource = "stripe" | "google_play" | "complimentary" | "trial" | "free";

export interface PlanSourceInput {
  /** Email of the workspace OWNER, which is what a complimentary grant keys on. */
  ownerEmail: string | null | undefined;
  edition: Edition;
  planId: PlanId;
  /** Present only once Stripe has actually created a subscription. */
  stripeSubscriptionId: string | null | undefined;
  isTrial: boolean;
}

export function resolvePlanSource(input: PlanSourceInput): PlanSource {
  if (overriddenPlanForEmail(input.ownerEmail, input.edition)) return "complimentary";
  if (input.stripeSubscriptionId && input.planId !== "FREE") return "stripe";
  if (input.isTrial) return "trial";
  return "free";
}

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
