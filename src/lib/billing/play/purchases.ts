import "server-only";

import type { PlayPurchase } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import type { PlayCandidateInput } from "../resolution";
import { playEntitlement } from "./state";

/**
 * Reading the Play side of a workspace's entitlement.
 *
 * `play_purchases` is a source of truth, not a cache, so entitlement questions
 * are answered from these rows rather than from the resolved Subscription row.
 * That is what makes a stale cache harmless: the worst it can do is show a wrong
 * figure on the admin revenue roll-up until the next write.
 */

/** Rows that have not been superseded by a linked token or ended for good. */
export async function livePlayPurchases(workspaceId: string): Promise<PlayPurchase[]> {
  return prisma.playPurchase.findMany({
    where: { workspaceId, retiredAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Turns a stored row into the resolver's view of it. */
export function playCandidateFromRow(row: PlayPurchase, now = new Date()): PlayCandidateInput {
  const entitlement = playEntitlement({
    state: row.state,
    expiryTime: row.expiryTime,
    revoked: row.revokedAt !== null,
    now,
  });
  return {
    planId: row.plan,
    entitling: entitlement.entitling,
    status: entitlement.status,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    accessUntil: entitlement.accessUntil,
  };
}

export interface PlaySubscriptionSummary {
  purchaseToken: string;
  productId: string;
  basePlanId: string | null;
  state: string;
  expiryTime: Date | null;
  autoRenewing: boolean;
  acknowledged: boolean;
  /** Whether this purchase is what currently grants the workspace its tier. */
  entitling: boolean;
}

/**
 * The purchase to show on a billing screen: the entitling one if there is one,
 * otherwise the most recent live row, so a customer whose subscription is on
 * hold still sees something to fix rather than nothing at all.
 */
export function playSummaryFromRows(
  rows: PlayPurchase[],
  now = new Date()
): PlaySubscriptionSummary | null {
  if (rows.length === 0) return null;
  const entitling = rows.find((row) => playCandidateFromRow(row, now).entitling);
  const row = entitling ?? rows[0];
  return {
    purchaseToken: row.purchaseToken,
    productId: row.productId,
    basePlanId: row.basePlanId,
    state: row.state,
    expiryTime: row.expiryTime,
    autoRenewing: row.autoRenewing,
    acknowledged: row.acknowledged,
    entitling: Boolean(entitling),
  };
}
