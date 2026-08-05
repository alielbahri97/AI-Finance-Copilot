import "server-only";

import { cache } from "react";

import { getAiClient, type AiClient } from "@/lib/ai";
import type { FinanceTransaction } from "@/lib/finance/recurrence";
import { RECURRING_LOOKBACK_DAYS } from "@/lib/finance/recurring-spend";
import { prisma } from "@/lib/prisma";

import { labelToolCategories } from "./recurring-spend-ai";
import {
  analyzeRecurringSpend,
  withToolCategories,
  type RecurringSpendAudit,
} from "./recurring-spend";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long the labelling pass may take before the page gives up on it. The
 * page waits for this at worst, so it is a UX budget: without labels the audit
 * still shows every vendor, its cost and its price history, and only the
 * overlap badges are missing.
 */
const LABELLING_TIMEOUT_MS = 8_000;

/**
 * Loads the workspace's expense history and returns the recurring-spend audit.
 *
 * Income is filtered out in the query — a client payment repeats as reliably as
 * any subscription, and this page is about money leaving.
 *
 * The AI half is optional by design: when no provider key is configured (and
 * on any provider failure) the audit comes back exactly as the detector
 * measured it, with no tool categories and no overlap groups. That keeps the
 * page deterministic in CI, in self-hosted deployments without a key, and
 * whenever a provider is down.
 *
 * Request-memoized, so a render that reads the audit twice pays for the
 * labelling once.
 */
export const getRecurringSpendAudit = cache(async function getRecurringSpendAudit(
  workspaceId: string,
  now: Date = new Date()
): Promise<RecurringSpendAudit> {
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

  const audit = analyzeRecurringSpend(transactions, now);
  const active = audit.vendors.filter((vendor) => !vendor.overdue);
  if (active.length === 0) return audit;

  let ai: AiClient;
  try {
    ai = getAiClient();
  } catch {
    // No key configured is a deployment fact, not a problem with this page.
    return audit;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LABELLING_TIMEOUT_MS);
  try {
    const labels = await labelToolCategories(
      ai,
      active.map((vendor) => ({
        key: vendor.key,
        label: vendor.label,
        category: vendor.category,
      })),
      { signal: controller.signal }
    );
    return withToolCategories(audit, labels);
  } finally {
    clearTimeout(timer);
  }
});
