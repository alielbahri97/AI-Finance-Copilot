import "server-only";

import { cache } from "react";

import { logger, serializeError } from "@/lib/logger";

import type { Subscription, UsageRecord } from "@/generated/prisma/client";
import { DEFAULT_EDITION, type Edition } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_WORKSPACE_TYPE,
  editionForWorkspaceType,
  type WorkspaceType,
} from "@/lib/workspace/editions";

import { overriddenPlanForEmail } from "./plan-overrides";
import { getPlan, TRIAL_DAYS, trialPlan, type Plan, type PlanId } from "./plans";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Current calendar month key, e.g. "2026-07". */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface Usage {
  aiMessages: number;
  /** Transactions sent to the AI categorizer, not rows it managed to place. */
  aiCategorizations: number;
  csvImports: number;
  invoiceExtractions: number;
  exports: number;
}

export interface Entitlements {
  /** The effective plan after resolving the local trial, for this edition. */
  plan: Plan;
  planId: PlanId;
  /** Which edition's tier set applies. */
  workspaceType: WorkspaceType;
  edition: Edition;
  /** True while the card-free signup/referral trial grants the middle tier. */
  isTrial: boolean;
  trialEndsAt: string | null;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  period: string;
  usage: Usage;
}

/** Ensures the workspace has a Subscription row; starts the 14-day trial on first touch. */
export async function getOrCreateSubscription(workspaceId: string): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (existing) return existing;
  return prisma.subscription
    .create({
      data: { workspaceId, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * MS_PER_DAY) },
    })
    .catch(() => prisma.subscription.findUniqueOrThrow({ where: { workspaceId } }));
}

async function getOrCreateUsage(workspaceId: string, period: string): Promise<UsageRecord> {
  return prisma.usageRecord.upsert({
    where: { workspaceId_period: { workspaceId, period } },
    update: {},
    create: { workspaceId, period },
  });
}

/**
 * Resolves the effective plan: paid Stripe plan > local trial > Free.
 *
 * The edition only decides which tier the card-free trial grants (Pro for
 * Business, Plus for Personal); a paid plan is honoured as stored either way.
 */
export function resolvePlanId(
  subscription: Subscription,
  edition: Edition = DEFAULT_EDITION,
  now = new Date()
): {
  planId: PlanId;
  isTrial: boolean;
} {
  const paidStatuses = ["ACTIVE", "TRIALING", "PAST_DUE"];
  if (subscription.plan !== "FREE" && paidStatuses.includes(subscription.status)) {
    return { planId: subscription.plan, isTrial: subscription.status === "TRIALING" };
  }
  if (subscription.trialEndsAt && subscription.trialEndsAt > now) {
    return { planId: trialPlan(edition), isTrial: true };
  }
  return { planId: "FREE", isTrial: false };
}

/**
 * The central entitlements lookup: plan + limits + usage this period.
 * Per-request memoized with React cache() — layouts, pages and gates in one
 * request share a single subscription + usage lookup. API routes that
 * increment usage read entitlements once before incrementing, so the
 * request-scoped memo never serves stale quota decisions.
 *
 * Complimentary email overrides (see plan-overrides) win over Stripe/trial
 * for workspaces owned by allowlisted addresses, and are persisted so the
 * billing UI stays consistent.
 */
export const getEntitlements = cache(async (workspaceId: string): Promise<Entitlements> => {
  const [subscription, usage, workspace, owner] = await Promise.all([
    getOrCreateSubscription(workspaceId),
    getOrCreateUsage(workspaceId, currentPeriod()),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { type: true } }),
    prisma.workspaceMember.findFirst({
      where: { workspaceId, role: "OWNER" },
      select: { profile: { select: { email: true } } },
    }),
  ]);
  const period = currentPeriod();
  const workspaceType = workspace?.type ?? DEFAULT_WORKSPACE_TYPE;
  const edition = editionForWorkspaceType(workspaceType);
  const overridePlanId = overriddenPlanForEmail(owner?.profile.email, edition);
  const resolved = overridePlanId
    ? { planId: overridePlanId, isTrial: false }
    : resolvePlanId(subscription, edition);
  const { planId, isTrial } = resolved;

  if (
    overridePlanId &&
    (subscription.plan !== overridePlanId || subscription.status !== "ACTIVE")
  ) {
    // Persist so Billing and admin MRR reflect the grant; ignore races.
    void prisma.subscription
      .update({
        where: { workspaceId },
        data: { plan: overridePlanId, status: "ACTIVE" },
      })
      .catch((error) => {
        logger.error("[billing] failed to persist complimentary plan", {
          workspaceId,
          planId: overridePlanId,
          error: serializeError(error),
        });
      });
  }

  return {
    plan: getPlan(planId, edition),
    planId,
    workspaceType,
    edition,
    isTrial,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    subscriptionStatus: overridePlanId ? "ACTIVE" : subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    hasStripeCustomer: Boolean(subscription.stripeCustomerId),
    period,
    usage: {
      aiMessages: usage.aiMessages,
      aiCategorizations: usage.aiCategorizations,
      csvImports: usage.csvImports,
      invoiceExtractions: usage.invoiceExtractions,
      exports: usage.exports,
    },
  };
});

export type UsageField =
  | "aiMessages"
  | "aiCategorizations"
  | "csvImports"
  | "invoiceExtractions"
  | "exports";

/** Increments a workspace usage counter for the current period. Never throws. */
export async function incrementUsage(
  workspaceId: string,
  field: UsageField,
  by = 1
): Promise<void> {
  const period = currentPeriod();
  try {
    await prisma.usageRecord.upsert({
      where: { workspaceId_period: { workspaceId, period } },
      update: { [field]: { increment: by } },
      create: { workspaceId, period, [field]: by },
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

/**
 * Standard 402 payload for gated features, with an upgrade hint for the UI.
 *
 * `edition` is required rather than defaulted: these messages name a plan on a
 * screen whose job is to sell it, so naming a tier the workspace's edition does
 * not sell has to be a compile error, not a silent fallback.
 */
export function upgradeError(
  feature: string,
  planId: PlanId,
  edition: Edition
): {
  error: string;
  code: string;
  feature: string;
  plan: PlanId;
} {
  return {
    error: `${feature} is not available on your current plan (${getPlan(planId, edition).name}). Upgrade on the Billing page to continue.`,
    code: "UPGRADE_REQUIRED",
    feature,
    plan: planId,
  };
}

/** Standard 402 payload for exhausted monthly quotas. */
export function limitError(
  feature: string,
  planId: PlanId,
  edition: Edition
): {
  error: string;
  code: string;
  feature: string;
  plan: PlanId;
} {
  return {
    error: `You have reached this month's ${feature} limit on the ${getPlan(planId, edition).name} plan. Upgrade on the Billing page for a higher limit.`,
    code: "LIMIT_REACHED",
    feature,
    plan: planId,
  };
}
