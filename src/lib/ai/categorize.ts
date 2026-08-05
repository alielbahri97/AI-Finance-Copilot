import "server-only";

import { getEntitlements, incrementUsage } from "@/lib/billing/entitlements";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { getAiClient, providerFromProfile, type AiClient } from ".";
import {
  buildCategorizationPrompt,
  categorizationBudget,
  CATEGORIZATION_SYSTEM_PROMPT,
  MAX_PROMPT_CATEGORIES,
  MAX_TRANSACTIONS_PER_BATCH,
  parseCategorizationOutput,
  selectConfidentAssignments,
  selectPromptCategories,
  type CategorizableTransaction,
  type PromptCategory,
} from "./categorize-core";

/**
 * AI categorization of transactions that no CategoryRule matched.
 *
 * Two hard promises hold this whole feature together:
 *   1. A rule always wins. The AI is only ever shown rows that came out of
 *      rule matching uncategorized, so a rule the user taught us can never be
 *      overridden by a model's opinion.
 *   2. An AI failure never fails an import. Every path here returns a count
 *      and a reason; nothing throws out of `autoCategorizeImportBatch`.
 */

/**
 * How long the whole categorization pass may take before the import gives up
 * on it. The import response waits for this at worst, so it is a UX budget
 * rather than a technical one; rows not reached simply stay uncategorized and
 * the user can still fix them by hand or on the next import.
 */
export const CATEGORIZATION_TIMEOUT_MS = 12_000;

/** Rows per import handed to the AI. Three batches fit comfortably in the budget. */
export const MAX_AI_ROWS_PER_IMPORT = 150;

export interface CategorizationBatchOutcome {
  /** Transaction index within the batch → category id. */
  assignments: Map<number, string>;
  /** Why the batch produced nothing usable, for logs. Null on success. */
  failureReason: string | null;
}

const EMPTY_BATCH: CategorizationBatchOutcome = { assignments: new Map(), failureReason: null };

/**
 * Categorizes one batch of up to {@link MAX_TRANSACTIONS_PER_BATCH}
 * transactions. Invalid JSON gets exactly one retry that shows the model its
 * own output and the validation error — the same shape of recovery invoice
 * extraction uses — and then gives up.
 *
 * Throws only what the AI client throws; callers decide whether that matters.
 */
export async function categorizeTransactionBatch(
  ai: AiClient,
  transactions: CategorizableTransaction[],
  categories: PromptCategory[],
  options: { signal?: AbortSignal } = {}
): Promise<CategorizationBatchOutcome> {
  if (transactions.length === 0 || categories.length === 0) return EMPTY_BATCH;

  const prompt = buildCategorizationPrompt(transactions, categories);
  const chatOptions = {
    temperature: 0,
    maxTokens: 2000,
    jsonMode: true,
    signal: options.signal,
  };

  const first = await ai.chat(
    [
      { role: "system", content: CATEGORIZATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    chatOptions
  );

  let parsed = parseCategorizationOutput(first);
  if (!parsed.ok) {
    const second = await ai.chat(
      [
        { role: "system", content: CATEGORIZATION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
        { role: "assistant", content: first.slice(0, 4000) },
        {
          role: "user",
          content: `That response was rejected: ${parsed.error} Reply again with ONLY the JSON object — no explanations, no markdown fences, no trailing commas.`,
        },
      ],
      chatOptions
    );
    parsed = parseCategorizationOutput(second);
  }

  if (!parsed.ok) {
    return { assignments: new Map(), failureReason: parsed.error };
  }

  return {
    assignments: selectConfidentAssignments(parsed.suggestions, {
      transactions,
      categories: new Map(categories.map((category) => [category.id, category.type])),
    }),
    failureReason: null,
  };
}

/**
 * Why a pass categorized fewer rows than it could have. `null` means nothing
 * stood in the way — including the case where the AI simply was not confident
 * about anything.
 */
export type CategorizationSkipReason =
  | "disabled"
  | "no_categories"
  | "no_provider"
  | "quota"
  | "failed";

export interface AutoCategorizationResult {
  /** Rows given a category by the AI. */
  categorized: number;
  /** Rows offered to the AI (what the monthly quota is charged for). */
  considered: number;
  skipped: CategorizationSkipReason | null;
  /** One sentence for the import summary, or null when there is nothing to say. */
  note: string | null;
}

const NOTHING_TO_DO: AutoCategorizationResult = {
  categorized: 0,
  considered: 0,
  skipped: null,
  note: null,
};

function result(
  partial: Partial<AutoCategorizationResult> & Pick<AutoCategorizationResult, "skipped">
): AutoCategorizationResult {
  return { ...NOTHING_TO_DO, ...partial };
}

/** The workspace's categories, most-used first, capped for the prompt. */
async function loadPromptCategories(workspaceId: string): Promise<PromptCategory[]> {
  const categories = await prisma.category.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      type: true,
      _count: { select: { transactions: true } },
    },
  });
  return selectPromptCategories(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type,
      usage: category._count.transactions,
    })),
    MAX_PROMPT_CATEGORIES
  );
}

/** Writes the assignments back, one statement per distinct category. */
async function applyAssignments(
  workspaceId: string,
  assignments: { transactionId: string; categoryId: string }[]
): Promise<number> {
  const byCategory = new Map<string, string[]>();
  for (const assignment of assignments) {
    const ids = byCategory.get(assignment.categoryId);
    if (ids) ids.push(assignment.transactionId);
    else byCategory.set(assignment.categoryId, [assignment.transactionId]);
  }

  let updated = 0;
  for (const [categoryId, ids] of byCategory) {
    // categoryId: null keeps this idempotent: a row the user categorized
    // between the import and this write is left alone.
    const { count } = await prisma.transaction.updateMany({
      where: { id: { in: ids }, workspaceId, categoryId: null },
      data: { categoryId },
    });
    updated += count;
  }
  return updated;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Categorizes the still-uncategorized rows of a just-created ImportBatch.
 *
 * Reading the rows back from the batch rather than taking them as an argument
 * is what makes this correct on re-import and safe to call twice: rule-matched
 * rows already have a category and are never selected, and neither are rows a
 * previous pass already handled.
 *
 * Never throws.
 */
export async function autoCategorizeImportBatch(
  scope: {
    workspaceId: string;
    batchId: string;
    /** The member's preferred provider, when the caller knows it. */
    aiProvider?: "OPENAI" | "ANTHROPIC" | "GROQ" | null;
  },
  options: { timeoutMs?: number } = {}
): Promise<AutoCategorizationResult> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? CATEGORIZATION_TIMEOUT_MS
  );

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: scope.workspaceId },
      select: { aiCategorizationEnabled: true },
    });
    if (!workspace) return NOTHING_TO_DO;
    if (!workspace.aiCategorizationEnabled) return result({ skipped: "disabled" });

    const pending = await prisma.transaction.findMany({
      where: { workspaceId: scope.workspaceId, importBatchId: scope.batchId, categoryId: null },
      orderBy: { date: "asc" },
      take: MAX_AI_ROWS_PER_IMPORT,
      select: {
        id: true,
        date: true,
        description: true,
        counterparty: true,
        amount: true,
        type: true,
      },
    });
    if (pending.length === 0) return NOTHING_TO_DO;

    const entitlements = await getEntitlements(scope.workspaceId);
    const limit = entitlements.plan.limits.aiCategorizationPerMonth;
    const budget = categorizationBudget(
      limit,
      entitlements.usage.aiCategorizations,
      pending.length
    );
    if (budget.allowed === 0) {
      return result({
        skipped: "quota",
        note: `AI categorization is paused for the rest of the month on the ${entitlements.plan.name} plan. Upgrade on the Billing page for unlimited automatic categorization.`,
      });
    }

    const categories = await loadPromptCategories(scope.workspaceId);
    if (categories.length === 0) return result({ skipped: "no_categories" });

    let ai: AiClient;
    try {
      ai = getAiClient(providerFromProfile(scope.aiProvider));
    } catch {
      // No key configured is a deployment fact, not an import problem.
      return result({ skipped: "no_provider" });
    }

    const considered = pending.slice(0, budget.allowed);
    const assignments: { transactionId: string; categoryId: string }[] = [];
    let failureReason: string | null = null;

    for (const batch of chunk(considered, MAX_TRANSACTIONS_PER_BATCH)) {
      if (controller.signal.aborted) break;
      const rows: CategorizableTransaction[] = batch.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        description: row.description,
        counterparty: row.counterparty,
        amount: Number(row.amount),
        type: row.type,
      }));

      try {
        const outcome = await categorizeTransactionBatch(ai, rows, categories, {
          signal: controller.signal,
        });
        failureReason ??= outcome.failureReason;
        for (const [index, categoryId] of outcome.assignments) {
          const row = batch[index];
          if (row) assignments.push({ transactionId: row.id, categoryId });
        }
      } catch (error) {
        failureReason ??= error instanceof Error ? error.message : String(error);
        logger.warn("[ai] transaction categorization batch failed", {
          workspaceId: scope.workspaceId,
          batchId: scope.batchId,
          error: serializeError(error),
        });
        break;
      }
    }

    const categorized =
      assignments.length > 0 ? await applyAssignments(scope.workspaceId, assignments) : 0;

    // The quota buys AI attention, not successful guesses: charge for the rows
    // that were actually sent, whatever came back.
    await incrementUsage(scope.workspaceId, "aiCategorizations", considered.length);

    if (categorized === 0 && failureReason) {
      return result({ skipped: "failed", considered: considered.length });
    }

    return {
      categorized,
      considered: considered.length,
      skipped: budget.limitReached ? "quota" : null,
      note: budget.limitReached
        ? `${pending.length - considered.length} rows were left for you because this month's AI categorization allowance on the ${entitlements.plan.name} plan ran out. Upgrade on the Billing page for unlimited automatic categorization.`
        : null,
    };
  } catch (error) {
    logger.error("[ai] transaction categorization failed", {
      workspaceId: scope.workspaceId,
      batchId: scope.batchId,
      error: serializeError(error),
    });
    return result({ skipped: "failed" });
  } finally {
    clearTimeout(timer);
  }
}
