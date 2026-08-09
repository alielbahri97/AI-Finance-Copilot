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

/** Past merchant→category examples included in a prompt (cheap few-shot). */
export const MAX_PROMPT_EXAMPLES = 20;

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

/**
 * A workspace-specific example the model can mirror: "this merchant was
 * previously filed under that category". Kept short so many fit cheaply.
 */
export interface CategorizationExample {
  merchant: string;
  categoryId: string;
  categoryName: string;
  type: TransactionType;
}

/**
 * A past merchant→category observation used for deterministic payee memory
 * (YNAB/Lunch Money style) before the LLM is asked.
 */
export interface MerchantHistoryRow {
  merchant: string;
  categoryId: string;
  type: TransactionType;
}

/* ------------------------------------------------------------------ */
/* Merchant / payee memory                                             */
/* ------------------------------------------------------------------ */

/**
 * Normalizes a merchant or description fragment for history lookup.
 * Digits and punctuation drop out so "AH #1234" and "AH" can still align.
 */
export function normalizeMerchantKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+/g, " ")
    .replace(/[^\p{L}\s.-]/gu, " ")
    .replace(/[.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Prefers counterparty (payee) over description — same bias as rule learning.
 */
export function merchantKeyFromTransaction(
  description: string,
  counterparty: string | null | undefined
): string | null {
  const fromCounterparty = normalizeMerchantKey(counterparty ?? "");
  if (fromCounterparty.length >= 2) return fromCounterparty;
  const fromDescription = normalizeMerchantKey(description);
  if (fromDescription.length >= 2) return fromDescription;
  return null;
}

/**
 * Builds a type|merchant → categoryId index. `history` should be newest-first;
 * the first write for a key wins (last-used payee category, YNAB-style).
 */
export function buildMerchantCategoryIndex(
  history: MerchantHistoryRow[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of history) {
    const merchant = normalizeMerchantKey(row.merchant);
    if (merchant.length < 2) continue;
    const key = `${row.type}|${merchant}`;
    if (!index.has(key)) index.set(key, row.categoryId);
  }
  return index;
}

/** Looks up the last-used category for this payee/direction, if any. */
export function matchMerchantHistory(
  description: string,
  counterparty: string | null | undefined,
  type: TransactionType,
  index: Map<string, string>
): string | null {
  const merchant = merchantKeyFromTransaction(description, counterparty);
  if (!merchant) return null;
  return index.get(`${type}|${merchant}`) ?? null;
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export const CATEGORIZATION_SYSTEM_PROMPT = `You categorize bank transactions into a FIXED list of existing categories for a personal/business finance app.

Reply with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:
{
  "suggestions": [
    { "transactionIndex": 0, "categoryId": "<exact id from the category list>", "confidence": 0.0 }
  ]
}

Hard rules:
- Use ONLY category ids from the provided list. Copy each id verbatim. Never invent ids, never invent categories, never rename categories.
- Prefer an exact semantic match to an existing category name (e.g. "Groceries", "Dining", "Transport"). If none fits well, OMIT the transaction — do not stretch a weak match.
- "transactionIndex" must be one of the indexes shown. Never invent indexes.
- Match direction strictly: INCOME rows → income categories only; EXPENSE rows → expense categories only.
- "confidence" is 0.0–1.0 and must reflect real certainty:
  - ≥0.9: well-known merchant or clear salary/payroll wording that maps cleanly to one category
  - 0.8–0.9: strong but not obvious (e.g. local shop that fits one category)
  - <0.8: omit — a missing suggestion is correct; a guess is not
- When "Past categorizations" examples are provided, treat them as the user's established mapping for that merchant and reuse the same categoryId when the new row is clearly the same counterparty/merchant.
- Transfers between own accounts, ATM cash, and non-spending movements: omit unless a listed category clearly covers them.
- Do not use category names as categoryId. If unsure which id belongs to a name, omit rather than guess.`;

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

function describeExample(example: CategorizationExample): string {
  return `- "${example.merchant.slice(0, 80)}" → ${example.categoryId} (${example.categoryName}, ${example.type})`;
}

/** Dedupes examples by merchant+category, capped for the prompt. */
export function selectPromptExamples(
  examples: CategorizationExample[],
  limit = MAX_PROMPT_EXAMPLES
): CategorizationExample[] {
  const seen = new Set<string>();
  const selected: CategorizationExample[] = [];
  for (const example of examples) {
    const merchant = example.merchant.trim();
    if (!merchant) continue;
    const key = `${merchant.toLowerCase()}|${example.categoryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...example, merchant });
    if (selected.length >= limit) break;
  }
  return selected;
}

/** The user message: the category menu, optional merchant hints, then transactions. */
export function buildCategorizationPrompt(
  transactions: CategorizableTransaction[],
  categories: PromptCategory[],
  examples: CategorizationExample[] = []
): string {
  const categoryLines = categories
    .map((category) => `- ${category.id} — ${category.name} (${category.type})`)
    .join("\n");
  const transactionLines = transactions
    .map((transaction, index) => describeTransaction(transaction, index))
    .join("\n");
  const selectedExamples = selectPromptExamples(examples);
  const exampleBlock =
    selectedExamples.length > 0
      ? `\nPast categorizations for similar merchants in this workspace (reuse the same categoryId when the merchant clearly matches):\n${selectedExamples.map(describeExample).join("\n")}\n`
      : "";

  return `Categories (id — name (direction)). Use ONLY these ids; prefer the listed names as-is — do not invent new categories:
${categoryLines}
${exampleBlock}
Transactions (index. date | direction | amount | description | counterparty):
${transactionLines}

Return the JSON object described in the system message. Omit any transaction you cannot place with confidence ≥ 0.8.`;
}

/* ------------------------------------------------------------------ */
/* Parsing model output                                                */
/* ------------------------------------------------------------------ */

const suggestionSchema = z.object({
  transactionIndex: z.coerce.number().int().min(0),
  categoryId: z.coerce.string().trim().min(1).max(120),
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

/**
 * Accepts the documented shape, a bare array, usual key synonyms, and the
 * common mistake of putting the category name in `category` / `categoryName`
 * instead of (or as well as) `categoryId`.
 */
function normalizeResponseShape(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { suggestions: normalizeSuggestionRows(parsed) };
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["suggestions", "results", "categorizations", "transactions"]) {
      if (Array.isArray(record[key])) {
        return { suggestions: normalizeSuggestionRows(record[key]) };
      }
    }
  }
  return parsed;
}

function normalizeSuggestionRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const record = row as Record<string, unknown>;
    const categoryId =
      record.categoryId ?? record.category_id ?? record.category ?? record.categoryName;
    return categoryId === undefined ? record : { ...record, categoryId };
  });
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
  /**
   * Lowercased exact category name → id. Recovers the common case where the
   * model returns a category name instead of its id.
   */
  categoryNames?: Map<string, string>;
  threshold?: number;
}

/**
 * Resolves a model-supplied category token to a known id. Prefers a verbatim
 * id match; falls back to an exact (case-insensitive) name match so a reply
 * of `"Groceries"` still maps when that name exists — never invents one.
 */
export function resolveCategoryId(
  token: string,
  categories: Map<string, TransactionType>,
  categoryNames?: Map<string, string>
): string | null {
  if (categories.has(token)) return token;
  const byName = categoryNames?.get(token.trim().toLowerCase());
  if (byName && categories.has(byName)) return byName;
  return null;
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

    const categoryId = resolveCategoryId(
      suggestion.categoryId,
      context.categories,
      context.categoryNames
    );
    if (!categoryId) continue;

    const categoryType = context.categories.get(categoryId);
    if (!categoryType) continue;
    if (categoryType !== transaction.type) continue;

    assignments.set(suggestion.transactionIndex, categoryId);
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
