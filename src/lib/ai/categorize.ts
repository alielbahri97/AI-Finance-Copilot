import "server-only";

import { getEntitlements, incrementUsage } from "@/lib/billing/entitlements";
import { getTransferCategoryIds } from "@/lib/categories";
import { loadOwnAccountRefs } from "@/lib/integrations/bank-accounts";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isInternalTransfer, isTransferCategoryName } from "@/lib/transfers";

import { getAiClient, providerFromProfile, type AiClient } from ".";
import {
  buildCategorizationPrompt,
  buildMerchantCategoryIndex,
  categorizationBudget,
  CATEGORIZATION_SYSTEM_PROMPT,
  matchMerchantHistory,
  MAX_PROMPT_CATEGORIES,
  MAX_PROMPT_EXAMPLES,
  MAX_TRANSACTIONS_PER_BATCH,
  merchantKeyFromTransaction,
  parseCategorizationOutput,
  selectConfidentAssignments,
  selectPromptCategories,
  type CategorizableTransaction,
  type CategorizationExample,
  type PromptCategory,
} from "./categorize-core";

/**
 * Categorization of rows that no CategoryRule matched on import.
 *
 * Layered pipeline (rules already applied at insert time):
 *   1. Own-account transfer detection → Transfer / Transfer in
 *   2. Merchant / payee history (last-used category for that counterparty)
 *   3. LLM only on what remains — skip if uncertain, never invent categories
 *
 * Hard promises:
 *   - A rule always wins (those rows never reach this pass).
 *   - An AI failure never fails an import.
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
  options: { signal?: AbortSignal; examples?: CategorizationExample[] } = {}
): Promise<CategorizationBatchOutcome> {
  if (transactions.length === 0 || categories.length === 0) return EMPTY_BATCH;

  const prompt = buildCategorizationPrompt(
    transactions,
    categories,
    options.examples ?? []
  );
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

  const categoryNames = new Map(
    categories.map((category) => [category.name.trim().toLowerCase(), category.id])
  );

  return {
    assignments: selectConfidentAssignments(parsed.suggestions, {
      transactions,
      categories: new Map(categories.map((category) => [category.id, category.type])),
      categoryNames,
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

/**
 * Recent categorized payees for deterministic history matching and few-shot
 * examples. Newest first so last-used category wins per merchant.
 */
async function loadMerchantHistory(
  workspaceId: string
): Promise<{ examples: CategorizationExample[]; index: Map<string, string> }> {
  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      categoryId: { not: null },
      OR: [{ counterparty: { not: null } }, { description: { not: "" } }],
    },
    orderBy: { date: "desc" },
    take: 400,
    select: {
      description: true,
      counterparty: true,
      type: true,
      category: { select: { id: true, name: true, type: true } },
    },
  });

  const history: {
    merchant: string;
    categoryId: string;
    categoryName: string;
    type: (typeof rows)[number]["type"];
  }[] = [];

  for (const row of rows) {
    if (!row.category) continue;
    // Do not teach the model (or history index) to copy transfer categories
    // onto ordinary spend — those are handled by the transfer layer.
    if (isTransferCategoryName(row.category.name)) continue;
    const merchant =
      merchantKeyFromTransaction(row.description, row.counterparty) ??
      (row.counterparty?.trim() || row.description.trim());
    if (!merchant) continue;
    history.push({
      merchant,
      categoryId: row.category.id,
      categoryName: row.category.name,
      type: row.type,
    });
  }

  const examples: CategorizationExample[] = history
    .slice(0, MAX_PROMPT_EXAMPLES * 3)
    .map((row) => ({
      merchant: row.merchant,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      type: row.type,
    }));

  return {
    examples,
    index: buildMerchantCategoryIndex(history),
  };
}

type PendingRow = {
  id: string;
  date: Date;
  description: string;
  counterparty: string | null;
  amount: unknown;
  type: "INCOME" | "EXPENSE";
  userId: string;
};

/** Deterministic layers that run before (and without) the LLM. */
async function applyDeterministicLayers(
  workspaceId: string,
  userId: string,
  pending: PendingRow[]
): Promise<{
  remaining: PendingRow[];
  categorized: number;
  examples: CategorizationExample[];
}> {
  if (pending.length === 0) {
    return { remaining: pending, categorized: 0, examples: [] };
  }

  const [accounts, transferIds, history] = await Promise.all([
    loadOwnAccountRefs(workspaceId),
    getTransferCategoryIds(workspaceId, userId),
    loadMerchantHistory(workspaceId),
  ]);

  const assignments: { transactionId: string; categoryId: string }[] = [];
  const remaining: PendingRow[] = [];

  for (const row of pending) {
    let categoryId: string | null = null;

    if (transferIds && isInternalTransfer(row.description, row.counterparty, accounts)) {
      categoryId = row.type === "INCOME" ? transferIds.incomeId : transferIds.expenseId;
    } else {
      categoryId = matchMerchantHistory(
        row.description,
        row.counterparty,
        row.type,
        history.index
      );
    }

    if (categoryId) assignments.push({ transactionId: row.id, categoryId });
    else remaining.push(row);
  }

  const categorized =
    assignments.length > 0 ? await applyAssignments(workspaceId, assignments) : 0;
  return { remaining, categorized, examples: history.examples };
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
 * Order: transfer detection → merchant history → AI (if enabled). Reading the
 * rows back from the batch makes this safe to call twice: already-categorized
 * rows are never selected.
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
    const pending = await prisma.transaction.findMany({
      where: { workspaceId: scope.workspaceId, importBatchId: scope.batchId, categoryId: null },
      orderBy: { date: "asc" },
      take: MAX_AI_ROWS_PER_IMPORT,
      select: {
        id: true,
        userId: true,
        date: true,
        description: true,
        counterparty: true,
        amount: true,
        type: true,
      },
    });
    if (pending.length === 0) return NOTHING_TO_DO;

    const userId = pending[0]?.userId;
    if (!userId) return NOTHING_TO_DO;

    const deterministic = await applyDeterministicLayers(scope.workspaceId, userId, pending);
    let categorized = deterministic.categorized;
    const forAi = deterministic.remaining;
    const examples = deterministic.examples;

    const workspace = await prisma.workspace.findUnique({
      where: { id: scope.workspaceId },
      select: { aiCategorizationEnabled: true },
    });
    if (!workspace) {
      return { categorized, considered: 0, skipped: null, note: null };
    }
    if (!workspace.aiCategorizationEnabled) {
      return {
        categorized,
        considered: 0,
        skipped: forAi.length > 0 ? "disabled" : null,
        note: null,
      };
    }
    if (forAi.length === 0) {
      return { categorized, considered: 0, skipped: null, note: null };
    }

    const entitlements = await getEntitlements(scope.workspaceId);
    const limit = entitlements.plan.limits.aiCategorizationPerMonth;
    const budget = categorizationBudget(
      limit,
      entitlements.usage.aiCategorizations,
      forAi.length
    );
    if (budget.allowed === 0) {
      return result({
        categorized,
        skipped: "quota",
        note: `AI categorization is paused for the rest of the month on the ${entitlements.plan.name} plan. Upgrade on the Billing page for unlimited automatic categorization.`,
      });
    }

    const categories = await loadPromptCategories(scope.workspaceId);
    if (categories.length === 0) {
      return result({ categorized, skipped: "no_categories" });
    }

    let ai: AiClient;
    try {
      ai = getAiClient(providerFromProfile(scope.aiProvider));
    } catch {
      return result({ categorized, skipped: "no_provider" });
    }

    const considered = forAi.slice(0, budget.allowed);
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
          examples,
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

    if (assignments.length > 0) {
      categorized += await applyAssignments(scope.workspaceId, assignments);
    }

    // Quota buys AI attention, not successful guesses: charge for rows sent.
    await incrementUsage(scope.workspaceId, "aiCategorizations", considered.length);

    if (categorized === 0 && failureReason) {
      return result({ skipped: "failed", considered: considered.length });
    }

    return {
      categorized,
      considered: considered.length,
      skipped: budget.limitReached ? "quota" : null,
      note: budget.limitReached
        ? `${forAi.length - considered.length} rows were left for you because this month's AI categorization allowance on the ${entitlements.plan.name} plan ran out. Upgrade on the Billing page for unlimited automatic categorization.`
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
