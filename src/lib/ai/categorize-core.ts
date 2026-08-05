import { z } from "zod";

import type { TransactionType } from "@/generated/prisma/client";
import { stripTrailingCommas } from "@/lib/invoices/extraction-core";

/**
 * Pure transaction-categorization logic: prompt construction, tolerant JSON
 * parsing of model output, hallucination filtering and the monthly quota
 * arithmetic. No AI or DB calls — fully unit-testable, which matters here
 * because every rule in this file exists to stop a confused model from
 * writing nonsense into somebody's books.
 */

/**
 * Suggestions below this are dropped: a half-sure guess is worse than an
 * uncategorized row, because the user never learns to check it.
 */
export const CATEGORIZATION_CONFIDENCE_THRESHOLD = 0.8;

/** Categories offered to the model. Long lists dilute the choice and cost tokens. */
export const MAX_PROMPT_CATEGORIES = 60;

/** Transactions per request. Larger batches start losing index alignment. */
export const MAX_TRANSACTIONS_PER_BATCH = 50;

export interface CategorizableTransaction {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description: string;
  counterparty: string | null;
  /** Positive amount, as stored. */
  amount: number;
  type: TransactionType;
}

export interface PromptCategory {
  id: string;
  name: string;
  type: TransactionType;
  /** How many transactions already use it; decides who survives the cap. */
  usage?: number;
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export const CATEGORIZATION_SYSTEM_PROMPT = `You categorize bank transactions into a fixed set of categories.

Reply with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:
{
  "suggestions": [
    { "transactionIndex": 0, "categoryId": "<one of the given category ids>", "confidence": 0.0 }
  ]
}

Rules:
- "transactionIndex" is the index shown next to the transaction. Never invent indexes.
- "categoryId" MUST be copied verbatim from the category list. Never invent an id and never use a category name.
- Match the transaction's direction: use an income category for INCOME rows and an expense category for EXPENSE rows.
- "confidence" is 0.0-1.0 and must reflect real certainty. A recognisable merchant is high; a vague reference number is low.
- Omit any transaction you cannot place with confidence. A missing suggestion is correct behaviour, a guess is not.
- Transfers between the person's own accounts, ATM withdrawals and other movements that are not spending should be omitted unless a category clearly covers them.`;

/**
 * The categories to offer the model, most-used first and capped. Ordering by
 * usage keeps the workspace's real vocabulary in the prompt when a workspace
 * has accumulated hundreds of categories.
 */
export function selectPromptCategories(
  categories: PromptCategory[],
  limit = MAX_PROMPT_CATEGORIES
): PromptCategory[] {
  return [...categories]
    .sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

function describeTransaction(transaction: CategorizableTransaction, index: number): string {
  const counterparty = transaction.counterparty?.trim();
  const fields = [
    transaction.date,
    transaction.type,
    transaction.amount.toFixed(2),
    `"${transaction.description.trim().slice(0, 200)}"`,
  ];
  if (counterparty) fields.push(`counterparty: "${counterparty.slice(0, 120)}"`);
  return `${index}. ${fields.join(" | ")}`;
}

/** The user message: the category menu, then the numbered transactions. */
export function buildCategorizationPrompt(
  transactions: CategorizableTransaction[],
  categories: PromptCategory[]
): string {
  const categoryLines = categories
    .map((category) => `- ${category.id} — ${category.name} (${category.type})`)
    .join("\n");
  const transactionLines = transactions
    .map((transaction, index) => describeTransaction(transaction, index))
    .join("\n");

  return `Categories (id — name (direction)):
${categoryLines}

Transactions (index. date | direction | amount | description | counterparty):
${transactionLines}

Return the JSON object described in the system message.`;
}

/* ------------------------------------------------------------------ */
/* Parsing model output                                                */
/* ------------------------------------------------------------------ */

const suggestionSchema = z.object({
  transactionIndex: z.coerce.number().int().min(0),
  categoryId: z.coerce.string().trim().min(1).max(64),
  confidence: z.coerce.number().min(0).max(1),
});

const responseSchema = z.object({
  suggestions: z.array(suggestionSchema).max(500),
});

export type CategorySuggestion = z.infer<typeof suggestionSchema>;

export type CategorizationParseOutcome =
  | { ok: true; suggestions: CategorySuggestion[] }
  | { ok: false; error: string };

/**
 * Finds the first balanced JSON object or array in free-form model output.
 * The array case matters here: asked for a list, models regularly reply with
 * a bare `[...]`, and `@/lib/invoices/extraction-core`'s object-only scanner
 * would lock onto the first element instead of the whole reply.
 */
export function extractFirstJsonBlock(raw: string): string | null {
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  const candidates = [objectStart, arrayStart].filter((index) => index !== -1);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  const open = raw[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Accepts the documented shape, a bare array, and the usual key synonyms. */
function normalizeResponseShape(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { suggestions: parsed };
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["suggestions", "results", "categorizations", "transactions"]) {
      if (Array.isArray(record[key])) return { suggestions: record[key] };
    }
  }
  return parsed;
}

/**
 * Parses model output into validated suggestions. Tolerates markdown fences,
 * leading prose and trailing commas. On failure the error text is written to
 * be usable verbatim in the retry prompt.
 */
export function parseCategorizationOutput(raw: string): CategorizationParseOutcome {
  const candidate = extractFirstJsonBlock(raw);
  if (!candidate) {
    return { ok: false, error: "No JSON object found in the response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommas(candidate));
    } catch (error) {
      return {
        ok: false,
        error: `The JSON is malformed: ${error instanceof Error ? error.message : "parse error"}.`,
      };
    }
  }

  const result = responseSchema.safeParse(normalizeResponseShape(parsed));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `The suggestions failed validation — ${issues}.` };
  }
  return { ok: true, suggestions: result.data.suggestions };
}

/* ------------------------------------------------------------------ */
/* Applying suggestions                                                */
/* ------------------------------------------------------------------ */

export interface SuggestionContext {
  /** The batch exactly as it was sent, so indexes line up. */
  transactions: Pick<CategorizableTransaction, "type">[];
  /** The categories offered in the prompt, by id. */
  categories: Map<string, TransactionType>;
  threshold?: number;
}

/**
 * Turns raw suggestions into the assignments worth writing, keyed by the
 * index of the transaction in the batch. Everything questionable is dropped:
 * an index that was never sent, a category id the workspace does not own
 * (the classic hallucination), a category pointing the wrong way for the
 * transaction's direction, and anything under the confidence threshold. The
 * first surviving suggestion for an index wins.
 */
export function selectConfidentAssignments(
  suggestions: CategorySuggestion[],
  context: SuggestionContext
): Map<number, string> {
  const threshold = context.threshold ?? CATEGORIZATION_CONFIDENCE_THRESHOLD;
  const assignments = new Map<number, string>();

  for (const suggestion of suggestions) {
    const transaction = context.transactions[suggestion.transactionIndex];
    if (!transaction) continue;
    if (assignments.has(suggestion.transactionIndex)) continue;
    if (suggestion.confidence < threshold) continue;

    const categoryType = context.categories.get(suggestion.categoryId);
    if (!categoryType) continue;
    if (categoryType !== transaction.type) continue;

    assignments.set(suggestion.transactionIndex, suggestion.categoryId);
  }

  return assignments;
}

/* ------------------------------------------------------------------ */
/* Quota                                                               */
/* ------------------------------------------------------------------ */

export interface CategorizationBudget {
  /** How many rows may be sent to the AI right now. */
  allowed: number;
  /** True when the monthly limit stopped us short of the whole request. */
  limitReached: boolean;
  /** Quota left after this request; null = unlimited. */
  remaining: number | null;
}

/**
 * How much of a request the plan's monthly row allowance covers. A partial
 * allowance is still worth spending — categorizing 40 of 100 rows beats
 * categorizing none — so the caller sends what fits and reports the rest.
 */
export function categorizationBudget(
  limit: number | null,
  used: number,
  requested: number
): CategorizationBudget {
  const wanted = Math.max(0, requested);
  if (limit === null) {
    return { allowed: wanted, limitReached: false, remaining: null };
  }
  const remaining = Math.max(0, limit - Math.max(0, used));
  const allowed = Math.min(wanted, remaining);
  return { allowed, limitReached: allowed < wanted, remaining: remaining - allowed };
}
