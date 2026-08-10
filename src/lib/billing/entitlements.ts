import "server-only";

import { cache } from "react";

import { logger, serializeError } from "@/lib/logger";

import type { PlanSource, Subscription, UsageRecord } from "@/generated/prisma/client";
import { DEFAULT_EDITION, type Edition } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_WORKSPACE_TYPE,
  editionForWorkspaceType,
  type WorkspaceType,
} from "@/lib/workspace/editions";

import { overriddenPlanForEmail } from "./plan-overrides";
import { getPlan, TRIAL_DAYS, type Plan, type PlanId } from "./plans";
import {
  livePlayPurchases,
  playCandidateFromRow,
  playSummaryFromRows,
  type PlaySubscriptionSummary,
} from "./play/purchases";
import {
  hasEntitlingStripeSubscription,
  resolveEntitlement,
  type SubscriptionLike,
} from "./resolution";

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
  /** Which payer the resolved plan came from. */
  planSource: PlanSource;
  /**
   * True while Stripe is paying for this workspace, whatever won resolution.
   * The Android client uses this to hide its purchase buttons: charging someone
   * a second time through Play because the web subscription was invisible is the
   * most expensive mistake available here.
   */
  hasActiveStripeSubscription: boolean;
  /** The workspace's Play subscription, if it has one. */
  play: PlaySubscriptionSummary | null;
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
 * Resolves the effective plan from the Subscription row alone.
 *
 * This is the cache-only view: paid plan on the row, then the local trial, then
 * Free — which is what it has always done, and what the admin revenue roll-up
 * wants, since that reads a hundred rows at a time and the cache is exactly the
 * figure it is rolling up.
 *
 * Anything deciding what a customer may actually *do* should call
 * `getEntitlements`, which resolves over every payer including Google Play. See
 * `resolveEntitlement` in ./resolution for the full order.
 *
 * The edition only decides which tier the card-free trial grants (Pro for
 * Business, Plus for Personal); a paid plan is honoured as stored either way.
 */
export function resolvePlanId(
  subscription: SubscriptionLike,
  edition: Edition = DEFAULT_EDITION,
  now = new Date()
): {
  planId: PlanId;
  isTrial: boolean;
} {
  const resolved = resolveEntitlement({ subscription, edition, now });
  return { planId: resolved.planId, isTrial: resolved.isTrial };
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
 *
 * Google Play is resolved here too, from the workspace's live play_purchases
 * rows rather than from the cached row, so an entitlement is never a stale
 * figure — see ./resolution for the order the payers are considered in.
 */
export const getEntitlements = cache(async (workspaceId: string): Promise<Entitlements> => {
  const [subscription, usage, workspace, owner, playRows] = await Promise.all([
    getOrCreateSubscription(workspaceId),
    getOrCreateUsage(workspaceId, currentPeriod()),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { type: true } }),
    prisma.workspaceMember.findFirst({
      where: { workspaceId, role: "OWNER" },
      select: { profile: { select: { email: true } } },
    }),
    livePlayPurchases(workspaceId).catch(() => []),
  ]);
  const period = currentPeriod();
  const now = new Date();
  const workspaceType = workspace?.type ?? DEFAULT_WORKSPACE_TYPE;
  const edition = editionForWorkspaceType(workspaceType);
  const overridePlanId = overriddenPlanForEmail(owner?.profile.email, edition);
  const resolved = resolveEntitlement({
    subscription,
    play: playRows.map((row) => playCandidateFromRow(row, now)),
    overridePlanId,
    edition,
    now,
  });
  const { planId, isTrial } = resolved;
  const playWon = resolved.source === "GOOGLE_PLAY";

  if (
    overridePlanId &&
    (subscription.plan !== overridePlanId ||
      subscription.status !== "ACTIVE" ||
      subscription.planSource !== "COMPLIMENTARY")
  ) {
    // Persist so Billing and admin MRR reflect the grant; ignore races. Only
    // the three resolved-cache columns are written: Stripe's own tier and
    // status, and the Play rows, are left exactly as they were, so the grant
    // can be withdrawn without having destroyed the record of what the customer
    // actually pays for.
    void prisma.subscription
      .update({
        where: { workspaceId },
        data: { plan: overridePlanId, status: "ACTIVE", planSource: "COMPLIMENTARY" },
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
    // These three describe the winning payer. For Stripe and the trial they are
    // read from the row, unchanged, because the Stripe webhook keeps them
    // current. For Play they come from the resolver, which read the purchase
    // rows a moment ago and is therefore never behind the cache.
    subscriptionStatus: playWon ? resolved.status : overridePlanId ? "ACTIVE" : subscription.status,
    cancelAtPeriodEnd: playWon ? resolved.cancelAtPeriodEnd : subscription.cancelAtPeriodEnd,
    currentPeriodEnd: (playWon ? resolved.currentPeriodEnd : subscription.currentPeriodEnd)
      ?.toISOString() ?? null,
    hasStripeCustomer: Boolean(subscription.stripeCustomerId),
    planSource: resolved.source,
    hasActiveStripeSubscription: hasEntitlingStripeSubscription(subscription),
    play: playSummaryFromRows(playRows, now),
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
