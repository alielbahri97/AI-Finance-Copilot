import "server-only";

import type { PlanId, PlayPurchase } from "@/generated/prisma/client";
import { editionForWorkspaceType } from "@/lib/workspace/editions";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import type { Edition } from "@/lib/branding";

import { getOrCreateSubscription } from "../entitlements";
import { overriddenPlanForEmail } from "../plan-overrides";
import { hasEntitlingStripeSubscription, resolveEntitlement } from "../resolution";
import { getPlaySubscription, PlayApiError, tryAcknowledgePlaySubscription } from "./api";
import { isPlayBillingConfigured, PlayConfigError } from "./config";
import { checkPlayIdentity, playIdentity } from "./identity";
import { playProductAllowedForEdition } from "./products";
import { livePlayPurchases, playCandidateFromRow } from "./purchases";
import {
  playEntitlement,
  readPlayPurchase,
  type PlayEntitlement,
  type PlaySubscriptionPurchaseV2,
} from "./state";

/**
 * Applying what Google says to the database.
 *
 * Both entry points — the client calling `/api/billing/play/verify` and a
 * Real-time Developer Notification arriving on `/api/billing/play/notifications`
 * — funnel through here, and both re-read the truth from
 * `purchases.subscriptionsv2.get` first. A notification is a hint that something
 * changed and is never treated as a statement of what it changed to, which is
 * Google's own explicit guidance:
 * https://developer.android.com/google/play/billing/lifecycle
 */

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type PlayVerifyFailureCode =
  | "PLAY_NOT_CONFIGURED"
  | "PLAY_UNAVAILABLE"
  | "PURCHASE_NOT_FOUND"
  | "PURCHASE_IDENTIFIERS_MISSING"
  | "PURCHASE_USER_MISMATCH"
  | "PURCHASE_WORKSPACE_MISMATCH"
  | "PRODUCT_NOT_OFFERED"
  | "PURCHASE_NOT_ACTIVE"
  | "STRIPE_SUBSCRIPTION_ACTIVE";

export interface PlayVerifySuccess {
  ok: true;
  planId: PlanId;
  productId: string;
  basePlanId: string | null;
  state: string;
  entitlement: PlayEntitlement;
  acknowledged: boolean;
  /** True when this token had already been verified before. */
  alreadyKnown: boolean;
}

export interface PlayVerifyFailure {
  ok: false;
  code: PlayVerifyFailureCode;
  message: string;
  /** Play's state, where the failure was about the state. */
  state?: string;
  /**
   * True when the customer's money is expected back without anyone doing
   * anything: Google refunds and revokes a purchase this server never
   * acknowledged, three days after it was made.
   */
  refundExpected?: boolean;
}

export type PlayVerifyResult = PlayVerifySuccess | PlayVerifyFailure;

/* ------------------------------------------------------------------ */
/* Verification (client-initiated)                                     */
/* ------------------------------------------------------------------ */

export interface VerifyPlayPurchaseInput {
  purchaseToken: string;
  workspaceId: string;
  userId: string;
  edition: Edition;
  now?: Date;
}

/**
 * Verifies a purchase token against Google and, if it holds up, grants the
 * workspace the tier it paid for.
 *
 * Idempotent by construction: the purchase token is unique, every write is an
 * upsert, and acknowledgement is skipped when Google already reports the
 * purchase as acknowledged. The Android client calls `queryPurchasesAsync` on
 * every app resume and re-presents whatever it finds, so the same token arrives
 * again and again and each arrival has to be cheap and harmless.
 */
export async function verifyPlayPurchase(
  input: VerifyPlayPurchaseInput
): Promise<PlayVerifyResult> {
  const now = input.now ?? new Date();
  const { purchaseToken, workspaceId, userId, edition } = input;

  if (!isPlayBillingConfigured()) {
    return {
      ok: false,
      code: "PLAY_NOT_CONFIGURED",
      message: "Google Play billing is not configured on this server.",
    };
  }

  let purchase: PlaySubscriptionPurchaseV2;
  try {
    purchase = await getPlaySubscription(purchaseToken);
  } catch (error) {
    if (error instanceof PlayApiError && error.isNotFound) {
      return {
        ok: false,
        code: "PURCHASE_NOT_FOUND",
        message: "Google Play does not recognise that purchase token.",
      };
    }
    if (error instanceof PlayConfigError) {
      return {
        ok: false,
        code: "PLAY_NOT_CONFIGURED",
        message: "Google Play billing is not configured on this server.",
      };
    }
    logger.error("play_verify_lookup_failed", { workspaceId, error: serializeError(error) });
    return {
      ok: false,
      code: "PLAY_UNAVAILABLE",
      message: "Google Play could not be reached to check that purchase. Try again shortly.",
    };
  }

  const facts = readPlayPurchase(purchase);

  // The obfuscated identifiers are the only thing tying a Play purchase to a
  // workspace rather than merely to a Google account, so a mismatch is a hard
  // failure and never a warning.
  const mismatch = checkPlayIdentity(facts.identifiers, playIdentity(userId, workspaceId));
  if (mismatch === "missing") {
    return {
      ok: false,
      code: "PURCHASE_IDENTIFIERS_MISSING",
      message:
        "That purchase carries no account identifiers, so it cannot be matched to this workspace. Update the app and try again.",
    };
  }
  if (mismatch === "account") {
    return {
      ok: false,
      code: "PURCHASE_USER_MISMATCH",
      message: "That purchase was made by a different Ballast account.",
    };
  }
  if (mismatch === "profile") {
    // The two-workspace case. A Google account can hold only one active
    // subscription per product, so a customer who wants a second workspace
    // cannot buy a second one in the app at all — they have to pay for it on
    // the web, and the message has to say so rather than just refusing.
    return {
      ok: false,
      code: "PURCHASE_WORKSPACE_MISMATCH",
      message:
        "That Google Play subscription already pays for a different workspace. Google Play allows one subscription per product per Google account, so a second workspace has to be paid for on the web at app.ballastmoney.com/billing.",
    };
  }

  if (!facts.productId || !facts.plan || !playProductAllowedForEdition(facts.productId, edition)) {
    logger.warn("play_verify_unknown_product", {
      workspaceId,
      productId: facts.productId,
      edition,
    });
    return {
      ok: false,
      code: "PRODUCT_NOT_OFFERED",
      message: "That subscription product is not one this workspace can be billed for.",
    };
  }

  const existing = await prisma.playPurchase.findUnique({ where: { purchaseToken } });

  // The double-payment guard. Only applied to a token this server has never
  // seen: a customer who bought through Play first and later added a Stripe
  // subscription on the web must not have their working Play entitlement
  // retired by a routine re-verification.
  if (!existing) {
    const subscription = await getOrCreateSubscription(workspaceId);
    if (hasEntitlingStripeSubscription(subscription)) {
      await retireRejectedPurchase({ purchaseToken, workspaceId, userId, facts, purchase, now });
      await recordAudit(workspaceId, userId, "billing.play_purchase_rejected", {
        reason: "STRIPE_SUBSCRIPTION_ACTIVE",
        productId: facts.productId,
      });
      return {
        ok: false,
        code: "STRIPE_SUBSCRIPTION_ACTIVE",
        message:
          "This workspace is already paid for on the web, so the Google Play purchase was not applied. It has not been acknowledged, which means Google refunds it automatically within three days. Manage the existing subscription on the web instead.",
        refundExpected: true,
      };
    }
  }

  const entitlement = playEntitlement({
    state: facts.state,
    expiryTime: facts.expiryTime,
    revoked: existing?.revokedAt !== null && existing?.revokedAt !== undefined,
    now,
  });

  // A purchase that does not entitle is still recorded — a pending purchase
  // becomes active later, and an expired one is what a support question is
  // about — but nothing is granted and, deliberately, nothing is acknowledged.
  const row = await persistPlayPurchase({
    purchaseToken,
    workspaceId,
    userId,
    facts,
    purchase,
    revokedAt: existing?.revokedAt ?? null,
    retiredAt: entitlement.terminal ? now : null,
    now,
  });

  if (facts.linkedPurchaseToken) {
    await retireLinkedPurchase(facts.linkedPurchaseToken, purchaseToken, now);
  }

  await refreshResolvedSubscription(workspaceId, now);

  if (!entitlement.entitling) {
    return {
      ok: false,
      code: "PURCHASE_NOT_ACTIVE",
      message: playStateMessage(facts.state),
      state: facts.state,
    };
  }

  const acknowledged = await ensureAcknowledged(row, facts.productId, facts.acknowledged, now);

  await prisma.subscription
    .update({ where: { workspaceId }, data: { userId } })
    .catch(() => undefined);

  await recordAudit(workspaceId, userId, "billing.play_purchase_verified", {
    productId: facts.productId,
    plan: facts.plan,
    state: facts.state,
    acknowledged,
    alreadyKnown: Boolean(existing),
  });

  return {
    ok: true,
    planId: facts.plan,
    productId: facts.productId,
    basePlanId: facts.basePlanId,
    state: facts.state,
    entitlement,
    acknowledged,
    alreadyKnown: Boolean(existing),
  };
}

function playStateMessage(state: string): string {
  switch (state) {
    case "SUBSCRIPTION_STATE_PENDING":
      return "That purchase is still waiting for payment to clear. It will start as soon as Google confirms it.";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "That subscription is on hold because the payment failed. Update the payment method in Google Play to restore access.";
    case "SUBSCRIPTION_STATE_PAUSED":
      return "That subscription is paused in Google Play. Resume it there to restore access.";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "That subscription has expired.";
    default:
      return "That subscription is not currently active in Google Play.";
  }
}

/* ------------------------------------------------------------------ */
/* Notification-initiated sync                                         */
/* ------------------------------------------------------------------ */

export type PlayNotificationOutcome =
  | { handled: true; workspaceId: string; planId: PlanId | null; state: string; entitling: boolean }
  | { handled: false; reason: "unknown_token" | "not_configured" | "lookup_failed" | "unknown_product" };

/** What a purchase Google no longer recognises is recorded as. */
const PLAY_GONE_STATE = "SUBSCRIPTION_STATE_EXPIRED";

export interface SyncFromNotificationInput {
  purchaseToken: string;
  /** RTDN notification type, or null for a voided-purchase notification. */
  notificationType: number | null;
  /** True for a revocation: a refund or a chargeback. Cuts access at once. */
  revoked: boolean;
  now?: Date;
}

/**
 * Re-reads a purchase from Google after a notification and applies the result.
 *
 * Attribution to a workspace works two ways, because a notification can arrive
 * about a token this server has never seen — which is exactly what happens on an
 * upgrade, a downgrade or a resubscribe, where Google mints a fresh token:
 *
 *   1. a local row for the token itself, or
 *   2. the row for the token it replaces, named by `linkedPurchaseToken` in
 *      Google's own answer.
 *
 * Neither means the purchase cannot be placed. The obfuscated identifiers Google
 * echoes are one-way hashes, so there is nothing to reverse them against, and the
 * purchase waits for the client's next `queryPurchasesAsync` reconciliation to
 * present it to `/verify`. Until then nothing is acknowledged, so the failure
 * mode is Google refunding the customer rather than an unpaid grant.
 */
export async function syncPlayPurchaseFromNotification(
  input: SyncFromNotificationInput
): Promise<PlayNotificationOutcome> {
  const now = input.now ?? new Date();
  const { purchaseToken } = input;

  if (!isPlayBillingConfigured()) {
    return { handled: false, reason: "not_configured" };
  }

  const existing = await prisma.playPurchase.findUnique({ where: { purchaseToken } });

  let purchase: PlaySubscriptionPurchaseV2 | null = null;
  try {
    purchase = await getPlaySubscription(purchaseToken);
  } catch (error) {
    if (!(error instanceof PlayApiError) || !error.isNotFound) {
      logger.error("play_notification_lookup_failed", {
        workspaceId: existing?.workspaceId,
        error: serializeError(error),
      });
      return { handled: false, reason: "lookup_failed" };
    }
    // Google no longer knows the token. With a local row that means the
    // purchase is gone for good and the row should retire; without one there is
    // nothing to do at all.
    if (!existing) return { handled: false, reason: "unknown_token" };
    logger.warn("play_notification_token_gone", { workspaceId: existing.workspaceId });
  }

  const facts = purchase ? readPlayPurchase(purchase) : null;

  // Attribution.
  let owner: { workspaceId: string; userId: string | null } | null = existing
    ? { workspaceId: existing.workspaceId, userId: existing.userId }
    : null;
  if (!owner && facts?.linkedPurchaseToken) {
    const predecessor = await prisma.playPurchase.findUnique({
      where: { purchaseToken: facts.linkedPurchaseToken },
    });
    if (predecessor) {
      owner = { workspaceId: predecessor.workspaceId, userId: predecessor.userId };
    }
  }
  if (!owner) {
    logger.warn("play_notification_unknown_token", {
      notificationType: input.notificationType,
      hasLinkedToken: Boolean(facts?.linkedPurchaseToken),
    });
    return { handled: false, reason: "unknown_token" };
  }

  const revokedAt = input.revoked ? (existing?.revokedAt ?? now) : (existing?.revokedAt ?? null);

  if (!facts) {
    await prisma.playPurchase.update({
      where: { purchaseToken },
      data: {
        state: PLAY_GONE_STATE,
        retiredAt: existing?.retiredAt ?? now,
        revokedAt,
        lastNotificationType: input.notificationType ?? existing?.lastNotificationType,
      },
    });
    await refreshResolvedSubscription(owner.workspaceId, now);
    return {
      handled: true,
      workspaceId: owner.workspaceId,
      planId: existing?.plan ?? null,
      state: PLAY_GONE_STATE,
      entitling: false,
    };
  }

  if (!facts.plan || !facts.productId) {
    logger.warn("play_notification_unknown_product", {
      workspaceId: owner.workspaceId,
      productId: facts.productId,
    });
    return { handled: false, reason: "unknown_product" };
  }

  const entitlement = playEntitlement({
    state: facts.state,
    expiryTime: facts.expiryTime,
    revoked: revokedAt !== null,
    now,
  });

  const row = await persistPlayPurchase({
    purchaseToken,
    workspaceId: owner.workspaceId,
    userId: owner.userId,
    facts,
    purchase: purchase as PlaySubscriptionPurchaseV2,
    revokedAt,
    // A revoked purchase retires at once. A cancelled one keeps its row until
    // the paid period it already covers has run out.
    retiredAt: revokedAt !== null || entitlement.terminal ? (existing?.retiredAt ?? now) : null,
    notificationType: input.notificationType,
    now,
  });

  // Upgrade, downgrade and resubscribe all issue a new token pointing at the
  // one it replaces. Not retiring the old row is the single most common Play
  // Billing bug: the workspace ends up with two apparently live subscriptions
  // and the resolver picks whichever ranks highest, which on a downgrade is the
  // tier the customer just stopped paying for.
  if (facts.linkedPurchaseToken) {
    await retireLinkedPurchase(facts.linkedPurchaseToken, purchaseToken, now);
  }

  if (entitlement.entitling) {
    await ensureAcknowledged(row, facts.productId, facts.acknowledged, now);
  }

  await refreshResolvedSubscription(owner.workspaceId, now);

  return {
    handled: true,
    workspaceId: owner.workspaceId,
    planId: facts.plan,
    state: facts.state,
    entitling: entitlement.entitling,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

interface PersistInput {
  purchaseToken: string;
  workspaceId: string;
  userId: string | null;
  facts: ReturnType<typeof readPlayPurchase>;
  purchase: PlaySubscriptionPurchaseV2;
  revokedAt: Date | null;
  retiredAt: Date | null;
  notificationType?: number | null;
  now: Date;
}

async function persistPlayPurchase(input: PersistInput): Promise<PlayPurchase> {
  const { facts } = input;
  const shared = {
    productId: facts.productId ?? "unknown",
    basePlanId: facts.basePlanId,
    plan: facts.plan ?? ("FREE" as PlanId),
    state: facts.state,
    latestOrderId: facts.latestOrderId,
    startTime: facts.startTime,
    expiryTime: facts.expiryTime,
    autoRenewing: facts.autoRenewing,
    linkedPurchaseToken: facts.linkedPurchaseToken,
    retiredAt: input.retiredAt,
    revokedAt: input.revokedAt,
    acknowledged: facts.acknowledged,
    obfuscatedAccountId: facts.identifiers?.obfuscatedExternalAccountId ?? null,
    obfuscatedProfileId: facts.identifiers?.obfuscatedExternalProfileId ?? null,
    raw: input.purchase as unknown as object,
    ...(input.notificationType != null ? { lastNotificationType: input.notificationType } : {}),
    ...(facts.acknowledged ? { acknowledgedAt: input.now } : {}),
  };

  return prisma.playPurchase.upsert({
    where: { purchaseToken: input.purchaseToken },
    create: {
      purchaseToken: input.purchaseToken,
      workspaceId: input.workspaceId,
      userId: input.userId,
      ...shared,
    },
    // The workspace is never moved by an update: a token belongs to the
    // workspace it was first verified against for good, so a later call cannot
    // reassign a paid subscription to somewhere else.
    update: shared,
  });
}

/** Records a purchase that was refused, in a state that grants nothing. */
async function retireRejectedPurchase(input: {
  purchaseToken: string;
  workspaceId: string;
  userId: string;
  facts: ReturnType<typeof readPlayPurchase>;
  purchase: PlaySubscriptionPurchaseV2;
  now: Date;
}): Promise<void> {
  await persistPlayPurchase({
    purchaseToken: input.purchaseToken,
    workspaceId: input.workspaceId,
    userId: input.userId,
    facts: input.facts,
    purchase: input.purchase,
    revokedAt: null,
    retiredAt: input.now,
    now: input.now,
  }).catch((error) => {
    logger.error("play_rejected_purchase_write_failed", {
      workspaceId: input.workspaceId,
      error: serializeError(error),
    });
  });
}

/**
 * Retires the token a new purchase replaces. Scoped to rows that are not the
 * replacement itself, so a payload that links a token to itself — which should
 * not happen, and would be catastrophic — cannot retire the live purchase.
 */
export async function retireLinkedPurchase(
  linkedPurchaseToken: string,
  replacementToken: string,
  now: Date
): Promise<number> {
  if (linkedPurchaseToken === replacementToken) return 0;
  const result = await prisma.playPurchase.updateMany({
    where: { purchaseToken: linkedPurchaseToken, retiredAt: null },
    data: { retiredAt: now },
  });
  if (result.count > 0) {
    logger.info("play_linked_purchase_retired", { replacementToken });
  }
  return result.count;
}

/**
 * Acknowledges the purchase unless Google already considers it acknowledged.
 *
 * Server-side, and retried, because the three-day deadline is enforced by an
 * automatic refund: an entitlement granted against a purchase that was never
 * acknowledged becomes an entitlement with no payment behind it. Failures are
 * recorded on the row (`ackAttempts`, `ackError`) so `pendingPlayAcknowledgements`
 * can find them again.
 */
export async function ensureAcknowledged(
  row: PlayPurchase,
  productId: string,
  alreadyAcknowledgedAtGoogle: boolean,
  now: Date
): Promise<boolean> {
  if (alreadyAcknowledgedAtGoogle) {
    if (!row.acknowledged) {
      await prisma.playPurchase
        .update({
          where: { purchaseToken: row.purchaseToken },
          data: { acknowledged: true, acknowledgedAt: now, ackError: null },
        })
        .catch(() => undefined);
    }
    return true;
  }

  const result = await tryAcknowledgePlaySubscription(productId, row.purchaseToken);
  await prisma.playPurchase
    .update({
      where: { purchaseToken: row.purchaseToken },
      data: result.ok
        ? { acknowledged: true, acknowledgedAt: now, ackError: null }
        : { ackAttempts: { increment: 1 }, ackError: result.error.slice(0, 500) },
    })
    .catch((error) => {
      logger.error("play_ack_state_write_failed", { error: serializeError(error) });
    });
  return result.ok;
}

/**
 * Purchases that entitle but were never acknowledged. Retried by
 * `/api/cron/play-acknowledge`, since a failed acknowledgement silently becomes a
 * refund three days later.
 */
export async function pendingPlayAcknowledgements(limit = 50): Promise<PlayPurchase[]> {
  return prisma.playPurchase.findMany({
    where: { acknowledged: false, retiredAt: null, revokedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export interface PlayAckSweepStats {
  considered: number;
  acknowledged: number;
  failed: number;
  skipped: number;
}

/**
 * Retries acknowledgement for every purchase still waiting for it.
 *
 * The deadline is three days and it is enforced by Google refunding the
 * customer, so this is a backstop rather than a nicety. It is not the only
 * retry: the client re-presents every live purchase token to `/verify` on each
 * app resume, and that path re-attempts acknowledgement too, so in practice a
 * transient failure is usually fixed within minutes and this sweep exists for
 * the customer who does not reopen the app.
 */
export async function runPlayAcknowledgementSweep(limit = 50): Promise<PlayAckSweepStats> {
  const stats: PlayAckSweepStats = { considered: 0, acknowledged: 0, failed: 0, skipped: 0 };
  if (!isPlayBillingConfigured()) return stats;

  const rows = await pendingPlayAcknowledgements(limit);
  stats.considered = rows.length;
  const now = new Date();

  for (const row of rows) {
    try {
      const purchase = await getPlaySubscription(row.purchaseToken);
      const facts = readPlayPurchase(purchase);
      const entitlement = playEntitlement({
        state: facts.state,
        expiryTime: facts.expiryTime,
        revoked: row.revokedAt !== null,
        now,
      });
      if (!entitlement.entitling || !facts.productId) {
        // Nothing to confirm: a purchase that does not entitle must not be
        // acknowledged, because acknowledgement is what stops the refund.
        stats.skipped += 1;
        continue;
      }
      const ok = await ensureAcknowledged(row, facts.productId, facts.acknowledged, now);
      if (ok) stats.acknowledged += 1;
      else stats.failed += 1;
    } catch (error) {
      stats.failed += 1;
      logger.error("play_ack_sweep_row_failed", {
        workspaceId: row.workspaceId,
        error: serializeError(error),
      });
    }
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/* The resolved cache                                                  */
/* ------------------------------------------------------------------ */

/**
 * Recomputes the Subscription row from every source and writes the result.
 *
 * The single writer for Play-driven cache updates. `plan` only ever holds a tier
 * somebody is paying for: a trial or a free workspace caches `FREE`, because the
 * trial is resolved from `trialEndsAt` at read time and writing the trial tier
 * into the plan column would make it indistinguishable from a paid one.
 */
export async function refreshResolvedSubscription(
  workspaceId: string,
  now = new Date()
): Promise<void> {
  try {
    const [subscription, workspace, owner, playRows] = await Promise.all([
      getOrCreateSubscription(workspaceId),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { type: true } }),
      prisma.workspaceMember.findFirst({
        where: { workspaceId, role: "OWNER" },
        select: { profile: { select: { email: true } } },
      }),
      livePlayPurchases(workspaceId),
    ]);

    const edition = editionForWorkspaceType(workspace?.type ?? "BUSINESS");
    const play = playRows.map((row) => playCandidateFromRow(row, now));
    const resolved = resolveEntitlement({
      subscription,
      play,
      overridePlanId: overriddenPlanForEmail(owner?.profile.email, edition),
      edition,
      now,
    });

    const playWon = resolved.source === "GOOGLE_PLAY";
    const unpaid = resolved.source === "FREE" || resolved.source === "TRIAL";
    const newestPlay = play[0] ?? null;

    const data = {
      plan: unpaid ? ("FREE" as PlanId) : resolved.planId,
      // With nobody paying, a Play row still says why — expired, on hold,
      // paused — and that is more useful on a billing screen than "ACTIVE".
      status: unpaid ? (newestPlay?.status ?? subscription.status) : resolved.status,
      planSource: resolved.source,
      ...(playWon
        ? {
            currentPeriodEnd: resolved.currentPeriodEnd,
            cancelAtPeriodEnd: resolved.cancelAtPeriodEnd,
          }
        : subscription.stripeSubscriptionId
          ? {}
          : {
              // No Stripe subscription has ever existed, so these columns are
              // Play's to clear rather than Stripe's to keep.
              currentPeriodEnd: newestPlay?.accessUntil ?? null,
              cancelAtPeriodEnd: newestPlay?.cancelAtPeriodEnd ?? false,
            }),
    };

    await prisma.subscription.update({ where: { workspaceId }, data });
  } catch (error) {
    logger.error("play_resolved_cache_write_failed", {
      workspaceId,
      error: serializeError(error),
    });
  }
}
