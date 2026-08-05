import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { autoCategorizeImportBatch } from "@/lib/ai/categorize";
import { loadRuleMatchers, matchCategory } from "@/lib/categories";
import { evaluateLargeTransactions } from "@/lib/notifications/alerts";
import { prisma } from "@/lib/prisma";

import { bankTransactionFingerprint } from "./fingerprint";

/**
 * Shared import pipeline for bank integrations (Plaid, Tink, GoCardless).
 * Reuses the stage-2 machinery: an ImportBatch per sync, per-user hash
 * dedupe, auto-categorization rules, and inline large-transaction alerts.
 */

export interface BankTransaction {
  /** Stable provider-scoped id, used as the dedupe fingerprint. */
  externalId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description: string;
  counterparty: string | null;
  /** Positive amount. */
  amount: number;
  type: "INCOME" | "EXPENSE";
}

export interface BankImportResult {
  imported: number;
  duplicates: number;
  batchId: string | null;
  /** Rows the AI categorized after rule matching left them empty. */
  aiCategorized: number;
}

export async function importBankTransactions(
  scope: { workspaceId: string; userId: string },
  currency: string,
  provider: string,
  label: string,
  transactions: BankTransaction[],
  options: { aiProvider?: "OPENAI" | "ANTHROPIC" | "GROQ" | null } = {}
): Promise<BankImportResult> {
  const { workspaceId, userId } = scope;
  if (transactions.length === 0) {
    return { imported: 0, duplicates: 0, batchId: null, aiCategorized: 0 };
  }

  const withHashes = transactions.map((tx) => ({
    ...tx,
    hash: bankTransactionFingerprint(provider, tx.externalId),
  }));

  const existing = await prisma.transaction.findMany({
    where: { workspaceId, hash: { in: withHashes.map((tx) => tx.hash) } },
    select: { hash: true },
  });
  const existingHashes = new Set(existing.map((row) => row.hash));
  const fresh = withHashes.filter((tx) => !existingHashes.has(tx.hash));
  const duplicates = withHashes.length - fresh.length;

  if (fresh.length === 0) {
    return { imported: 0, duplicates, batchId: null, aiCategorized: 0 };
  }

  const matchers = await loadRuleMatchers(workspaceId);
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: { workspaceId, userId, fileName: label.slice(0, 200) },
    });
    await tx.transaction.createMany({
      data: fresh.map((row) => ({
        workspaceId,
        userId,
        type: row.type,
        amount: Math.round(row.amount * 100) / 100,
        categoryId: matchCategory(matchers, row.description, row.counterparty),
        description: row.description.slice(0, 500),
        counterparty: row.counterparty?.slice(0, 300) ?? null,
        date: new Date(`${row.date}T00:00:00.000Z`),
        hash: row.hash,
        importBatchId: created.id,
      })),
      skipDuplicates: true,
    });
    return created;
  });

  await evaluateLargeTransactions(
    workspaceId,
    currency,
    fresh.map((row) => ({
      type: row.type,
      amount: row.amount,
      description: row.description,
      counterparty: row.counterparty,
      date: new Date(`${row.date}T00:00:00.000Z`),
    }))
  ).catch((error) => logger.error("[integrations] alert evaluation", { error: serializeError(error) }));

  // Same order as the CSV import: rules first, then the AI on what is left.
  const categorization = await autoCategorizeImportBatch({
    workspaceId,
    batchId: batch.id,
    aiProvider: options.aiProvider ?? null,
  });

  return {
    imported: fresh.length,
    duplicates,
    batchId: batch.id,
    aiCategorized: categorization.categorized,
  };
}
