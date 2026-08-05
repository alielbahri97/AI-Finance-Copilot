import "server-only";

import type { FinanceTransaction } from "@/lib/finance/recurrence";
import { RECURRING_LOOKBACK_DAYS } from "@/lib/finance/recurring-spend";
import { prisma } from "@/lib/prisma";

import { analyzeSubscriptions, type SubscriptionAnalysis } from "./subscriptions";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Loads the workspace's expense history and returns the subscription picture.
 * Income is filtered out in the query — a salary is recurring, but it is not
 * a subscription, and the analysis discards it anyway.
 */
export async function getSubscriptionsOverview(
  workspaceId: string,
  now: Date = new Date()
): Promise<SubscriptionAnalysis> {
  const windowStart = new Date(now.getTime() - RECURRING_LOOKBACK_DAYS * MS_PER_DAY);

  const rows = await prisma.transaction.findMany({
    where: { workspaceId, type: "EXPENSE", date: { gte: windowStart } },
    orderBy: { date: "asc" },
    select: {
      type: true,
      amount: true,
      date: true,
      description: true,
      counterparty: true,
      category: { select: { name: true } },
    },
  });

  const transactions: FinanceTransaction[] = rows.map((row) => ({
    type: row.type,
    amount: Number(row.amount),
    date: row.date,
    description: row.description,
    counterparty: row.counterparty,
    category: row.category?.name ?? "Uncategorized",
  }));

  return analyzeSubscriptions(transactions, now);
}
