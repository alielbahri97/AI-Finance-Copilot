import "server-only";

import { logger, serializeError } from "@/lib/logger";

import type { Subscription, UsageRecord } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { getPlan, TRIAL_DAYS, TRIAL_PLAN, type Plan, type PlanId } from "./plans";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Current calendar month key, e.g. "2026-07". */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface Usage {
  aiMessages: number;
  csvImports: number;
  invoiceExtractions: number;
  exports: number;
}

export interface Entitlements {
  /** The effective plan after resolving the local trial. */
  plan: Plan;
  planId: PlanId;
  /** True while the card-free signup/referral trial grants Pro. */
  isTrial: boolean;
  trialEndsAt: string | null;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  period: string;
  usage: Usage;
}

/** Ensures the user has a Subscription row; starts the 14-day trial on first touch. */
export async function getOrCreateSubscription(userId: string): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.subscription
    .create({
      data: { userId, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * MS_PER_DAY) },
    })
    .catch(() => prisma.subscription.findUniqueOrThrow({ where: { userId } }));
}

async function getOrCreateUsage(userId: string, period: string): Promise<UsageRecord> {
  return prisma.usageRecord.upsert({
    where: { userId_period: { userId, period } },
    update: {},
    create: { userId, period },
  });
}

/** Resolves the effective plan: paid Stripe plan > local trial > Free. */
export function resolvePlanId(subscription: Subscription, now = new Date()): {
  planId: PlanId;
  isTrial: boolean;
} {
  const paidStatuses = ["ACTIVE", "TRIALING", "PAST_DUE"];
  if (subscription.plan !== "FREE" && paidStatuses.includes(subscription.status)) {
    return { planId: subscription.plan, isTrial: subscription.status === "TRIALING" };
  }
  if (subscription.trialEndsAt && subscription.trialEndsAt > now) {
    return { planId: TRIAL_PLAN, isTrial: true };
  }
  return { planId: "FREE", isTrial: false };
}

/** The central entitlements lookup: plan + limits + usage this period. */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const subscription = await getOrCreateSubscription(userId);
  const period = currentPeriod();
  const usage = await getOrCreateUsage(userId, period);
  const { planId, isTrial } = resolvePlanId(subscription);

  return {
    plan: getPlan(planId),
    planId,
    isTrial,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    subscriptionStatus: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    hasStripeCustomer: Boolean(subscription.stripeCustomerId),
    period,
    usage: {
      aiMessages: usage.aiMessages,
      csvImports: usage.csvImports,
      invoiceExtractions: usage.invoiceExtractions,
      exports: usage.exports,
    },
  };
}

export type UsageField = "aiMessages" | "csvImports" | "invoiceExtractions" | "exports";

/** Increments a usage counter for the current period. Never throws. */
export async function incrementUsage(userId: string, field: UsageField, by = 1): Promise<void> {
  const period = currentPeriod();
  try {
    await prisma.usageRecord.upsert({
      where: { userId_period: { userId, period } },
      update: { [field]: { increment: by } },
      create: { userId, period, [field]: by },
    });
  } catch (error) {
    logger.error(`[billing] failed to increment ${field}`, { error: serializeError(error) });
  }
}

export interface LimitCheck {
  allowed: boolean;
  /** Remaining quota; null = unlimited. */
  remaining: number | null;
}

/** Compares a usage counter against the plan's monthly limit. */
export function checkLimit(
  entitlements: Entitlements,
  field: UsageField,
  limit: number | null
): LimitCheck {
  if (limit === null) return { allowed: true, remaining: null };
  const used = entitlements.usage[field];
  return { allowed: used < limit, remaining: Math.max(0, limit - used) };
}

/** Standard 402 payload for gated features, with an upgrade hint for the UI. */
export function upgradeError(feature: string, planId: PlanId): {
  error: string;
  code: string;
  feature: string;
  plan: PlanId;
} {
  return {
    error: `${feature} is not available on your current plan (${getPlan(planId).name}). Upgrade on the Billing page to continue.`,
    code: "UPGRADE_REQUIRED",
    feature,
    plan: planId,
  };
}

/** Standard 402 payload for exhausted monthly quotas. */
export function limitError(feature: string, planId: PlanId): {
  error: string;
  code: string;
  feature: string;
  plan: PlanId;
} {
  return {
    error: `You have reached this month's ${feature} limit on the ${getPlan(planId).name} plan. Upgrade on the Billing page for a higher limit.`,
    code: "LIMIT_REACHED",
    feature,
    plan: planId,
  };
}
