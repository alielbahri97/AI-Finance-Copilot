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

/** Seeds the default category set for users who have none yet. */
export async function ensureDefaultCategories(userId: string) {
  const count = await prisma.category.count({ where: { userId } });
  if (count > 0) return;
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId, isDefault: true })),
    skipDuplicates: true,
  });
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
    if (haystack.includes(matcher.pattern)) return matcher.categoryId;
  }
  return null;
}
