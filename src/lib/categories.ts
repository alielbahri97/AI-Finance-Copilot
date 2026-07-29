import "server-only";
import { prisma } from "@/lib/prisma";
import type { TransactionType } from "@/generated/prisma/client";

export const DEFAULT_CATEGORIES: { name: string; type: TransactionType; color: string }[] = [
  { name: "Salary", type: "INCOME", color: "#10b981" },
  { name: "Freelance", type: "INCOME", color: "#14b8a6" },
  { name: "Investments", type: "INCOME", color: "#06b6d4" },
  { name: "Other income", type: "INCOME", color: "#64748b" },
  { name: "Housing", type: "EXPENSE", color: "#6366f1" },
  { name: "Groceries", type: "EXPENSE", color: "#f59e0b" },
  { name: "Transport", type: "EXPENSE", color: "#3b82f6" },
  { name: "Dining", type: "EXPENSE", color: "#ef4444" },
  { name: "Entertainment", type: "EXPENSE", color: "#ec4899" },
  { name: "Health", type: "EXPENSE", color: "#22c55e" },
  { name: "Shopping", type: "EXPENSE", color: "#a855f7" },
  { name: "Utilities", type: "EXPENSE", color: "#0ea5e9" },
  { name: "Travel", type: "EXPENSE", color: "#f97316" },
  { name: "Subscriptions", type: "EXPENSE", color: "#8b5cf6" },
  { name: "Education", type: "EXPENSE", color: "#84cc16" },
  { name: "Other", type: "EXPENSE", color: "#64748b" },
];

/** Common merchant patterns seeded for new users (matched case-insensitively). */
export const DEFAULT_CATEGORY_RULES: { pattern: string; category: string }[] = [
  { pattern: "netflix", category: "Subscriptions" },
  { pattern: "spotify", category: "Subscriptions" },
  { pattern: "disney", category: "Subscriptions" },
  { pattern: "youtube premium", category: "Subscriptions" },
  { pattern: "apple.com/bill", category: "Subscriptions" },
  { pattern: "albert heijn", category: "Groceries" },
  { pattern: "jumbo", category: "Groceries" },
  { pattern: "lidl", category: "Groceries" },
  { pattern: "aldi", category: "Groceries" },
  { pattern: "whole foods", category: "Groceries" },
  { pattern: "trader joe", category: "Groceries" },
  { pattern: "shell", category: "Transport" },
  { pattern: "uber", category: "Transport" },
  { pattern: "lyft", category: "Transport" },
  { pattern: "ns reizigers", category: "Transport" },
  { pattern: "ov-chipkaart", category: "Transport" },
  { pattern: "starbucks", category: "Dining" },
  { pattern: "mcdonald", category: "Dining" },
  { pattern: "deliveroo", category: "Dining" },
  { pattern: "uber eats", category: "Dining" },
  { pattern: "rent", category: "Housing" },
  { pattern: "mortgage", category: "Housing" },
  { pattern: "salary", category: "Salary" },
  { pattern: "payroll", category: "Salary" },
  { pattern: "freelance", category: "Freelance" },
  { pattern: "amazon", category: "Shopping" },
  { pattern: "bol.com", category: "Shopping" },
];

/** Generic bank/payment phrases that should not become categorization rules. */
const NOISE_PATTERNS = new Set([
  "payment",
  "card payment",
  "debit",
  "credit",
  "transfer",
  "bank transfer",
  "wire transfer",
  "pos",
  "purchase",
  "transaction",
  "withdrawal",
  "deposit",
  "atm",
  "fee",
  "bank",
  "sepa",
  "ideal",
  "online",
  "online payment",
  "card",
  "visa",
  "mastercard",
  "unknown",
  "misc",
  "miscellaneous",
  "other",
  "general",
  "correction",
  "refund",
]);

const NOISE_TOKENS = new Set([
  "payment",
  "card",
  "debit",
  "credit",
  "transfer",
  "purchase",
  "transaction",
  "withdrawal",
  "deposit",
  "refund",
  "correction",
  "pos",
  "atm",
  "fee",
  "bank",
  "sepa",
  "ideal",
  "online",
  "visa",
  "mastercard",
  "nr",
  "ref",
  "id",
]);

/** Short function words that should not anchor a categorization rule. */
const STOPWORDS = new Set([
  "to",
  "from",
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "via",
]);

/** Seeds the default category set (and starter rules) for users who have none yet. */
export async function ensureDefaultCategories(userId: string) {
  const count = await prisma.category.count({ where: { userId } });
  if (count === 0) {
    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId, isDefault: true })),
      skipDuplicates: true,
    });
  }
  await ensureDefaultCategoryRules(userId);
}

async function ensureDefaultCategoryRules(userId: string) {
  const ruleCount = await prisma.categoryRule.count({ where: { userId } });
  if (ruleCount > 0) return;

  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const idByName = new Map(categories.map((category) => [category.name, category.id]));
  const data = DEFAULT_CATEGORY_RULES.flatMap((rule) => {
    const categoryId = idByName.get(rule.category);
    if (!categoryId) return [];
    return [{ userId, pattern: rule.pattern, categoryId }];
  });
  if (data.length === 0) return;
  await prisma.categoryRule.createMany({ data, skipDuplicates: true });
}

export interface RuleMatcher {
  pattern: string;
  categoryId: string;
}

/** Loads the user's auto-categorization rules, longest pattern first. */
export async function loadRuleMatchers(userId: string): Promise<RuleMatcher[]> {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    select: { pattern: true, categoryId: true },
  });
  return rules
    .map((rule) => ({ pattern: rule.pattern.toLowerCase(), categoryId: rule.categoryId }))
    .sort((a, b) => b.pattern.length - a.pattern.length);
}

/** Returns the category for a transaction description/counterparty, if a rule matches. */
export function matchCategory(
  matchers: RuleMatcher[],
  description: string,
  counterparty: string | null
): string | null {
  const haystack = `${description} ${counterparty ?? ""}`.toLowerCase();
  for (const matcher of matchers) {
    if (matcher.pattern && haystack.includes(matcher.pattern)) return matcher.categoryId;
  }
  return null;
}

/**
 * Normalizes merchant/description text into a stable keyword suitable for
 * substring matching in category rules.
 */
export function normalizeCategoryPattern(value: string): string {
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

function isUsefulPattern(pattern: string): boolean {
  if (pattern.length < 2) return false;
  if (NOISE_PATTERNS.has(pattern)) return false;
  return true;
}

/**
 * Drops payment noise and stopwords, keeping merchant-like keywords for a rule.
 */
export function compactCategoryPattern(normalized: string): string | null {
  const tokens = normalized.split(" ").filter(Boolean);
  const meaningful = tokens.filter(
    (token) => token.length >= 2 && !NOISE_TOKENS.has(token) && !STOPWORDS.has(token)
  );
  if (meaningful.length === 0) return null;
  const pattern = meaningful.join(" ").slice(0, 100);
  return isUsefulPattern(pattern) ? pattern : null;
}

/**
 * Picks a learnable pattern from a transaction. Prefers counterparty (merchant),
 * then description. Returns null for empty/noisy one-offs.
 */
export function extractCategoryPattern(
  description: string,
  counterparty: string | null | undefined
): string | null {
  const fromCounterparty = compactCategoryPattern(normalizeCategoryPattern(counterparty ?? ""));
  if (fromCounterparty) return fromCounterparty;

  const fromDescription = compactCategoryPattern(normalizeCategoryPattern(description));
  if (fromDescription) return fromDescription;

  return null;
}

export interface LearnedCategoryRule {
  pattern: string;
  categoryId: string;
  categoryName: string;
  /** True when an existing rule's category was overwritten. */
  updated: boolean;
}

/**
 * Creates or updates a CategoryRule from a manual categorization so future
 * similar transactions (import/create) get the same category. Latest manual
 * choice wins when the pattern already exists.
 */
export async function learnCategoryRule(
  userId: string,
  input: {
    description: string;
    counterparty: string | null | undefined;
    categoryId: string;
  }
): Promise<LearnedCategoryRule | null> {
  const pattern = extractCategoryPattern(input.description, input.counterparty);
  if (!pattern) return null;

  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId },
    select: { id: true, name: true },
  });
  if (!category) return null;

  const existing = await prisma.categoryRule.findFirst({
    where: { userId, pattern: { equals: pattern, mode: "insensitive" } },
    select: { id: true, pattern: true, categoryId: true },
  });

  if (existing) {
    if (existing.categoryId === category.id) {
      return {
        pattern: existing.pattern,
        categoryId: category.id,
        categoryName: category.name,
        updated: false,
      };
    }
    await prisma.categoryRule.update({
      where: { id: existing.id },
      data: { categoryId: category.id },
    });
    return {
      pattern: existing.pattern,
      categoryId: category.id,
      categoryName: category.name,
      updated: true,
    };
  }

  await prisma.categoryRule.create({
    data: { userId, pattern, categoryId: category.id },
  });
  return {
    pattern,
    categoryId: category.id,
    categoryName: category.name,
    updated: false,
  };
}

/**
 * Learns rules from one or more manually categorized transactions.
 * Dedupes by pattern so bulk edits create one rule per merchant keyword.
 */
export async function learnCategoryRulesFromTransactions(
  userId: string,
  categoryId: string,
  transactions: { description: string; counterparty: string | null }[]
): Promise<LearnedCategoryRule[]> {
  const seen = new Set<string>();
  const learned: LearnedCategoryRule[] = [];

  for (const tx of transactions) {
    const pattern = extractCategoryPattern(tx.description, tx.counterparty);
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);

    const result = await learnCategoryRule(userId, {
      description: tx.description,
      counterparty: tx.counterparty,
      categoryId,
    });
    if (result) learned.push(result);
  }

  return learned;
}
