import "server-only";

import { prisma } from "@/lib/prisma";

import {
  MAX_ROLLOVER_MONTHS,
  periodOf,
  periodRange,
  shiftMonths,
  spendKey,
  summarizeBudgets,
  type BudgetPeriod,
  type BudgetRow,
  type BudgetSummary,
} from "./budgets";

/**
 * Database side of the budgets page: loads the rows and the category spend
 * that `summarizeBudgets` needs, and converts Prisma `Decimal`s to numbers so
 * nothing downstream has to know the database's numeric type.
 */

export interface BudgetCategoryOption {
  id: string;
  name: string;
  color: string;
  type: "INCOME" | "EXPENSE";
}

export interface BudgetOverview {
  summary: BudgetSummary;
  /** Every category in the workspace, so the UI can offer unbudgeted ones. */
  categories: BudgetCategoryOption[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The window a rollover chain can reach back over: the target month plus the
 * `MAX_ROLLOVER_MONTHS` before it. Chains normally break long before that, but
 * loading the whole window in one query is cheaper than walking back month by
 * month with a query per step, and a budget row per category per month keeps
 * even 25 months small.
 */
function windowStart(target: BudgetPeriod): BudgetPeriod {
  return shiftMonths(target, -MAX_ROLLOVER_MONTHS);
}

/** Whether a stored row falls inside the window, as a comparable month index. */
function monthIndex(period: BudgetPeriod): number {
  return period.year * 12 + period.month;
}

export async function getBudgetOverview(
  workspaceId: string,
  target: BudgetPeriod
): Promise<BudgetOverview> {
  const start = windowStart(target);
  const spendWindow = { start: periodRange(start).start, end: periodRange(target).end };

  const [budgetRows, expenses, categories] = await Promise.all([
    // Budgets are stored as year/month columns rather than a date, so the
    // window is a year range here and trimmed to whole months below.
    prisma.budget.findMany({
      where: { workspaceId, year: { gte: start.year, lte: target.year } },
      select: {
        id: true,
        category: true,
        categoryId: true,
        limit: true,
        month: true,
        year: true,
        rollover: true,
      },
    }),
    prisma.transaction.findMany({
      where: {
        workspaceId,
        type: "EXPENSE",
        date: { gte: spendWindow.start, lt: spendWindow.end },
      },
      select: { amount: true, date: true, category: { select: { name: true } } },
    }),
    prisma.category.findMany({
      where: { workspaceId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true, type: true },
    }),
  ]);

  const lowest = monthIndex(start);
  const highest = monthIndex(target);
  const rows: BudgetRow[] = budgetRows
    .filter((row) => {
      const index = monthIndex(row);
      return index >= lowest && index <= highest;
    })
    .map((row) => ({
      id: row.id,
      category: row.category,
      categoryId: row.categoryId,
      limit: row.limit.toNumber(),
      month: row.month,
      year: row.year,
      rollover: row.rollover,
    }));

  // Budgets key off the category name, so uncategorized spend cannot belong
  // to one and is left out rather than attributed to an arbitrary budget.
  const spend = new Map<string, number>();
  for (const expense of expenses) {
    if (!expense.category) continue;
    const key = spendKey(expense.category.name, periodOf(expense.date));
    spend.set(key, round2((spend.get(key) ?? 0) + expense.amount.toNumber()));
  }

  return {
    summary: summarizeBudgets(rows, spend, target),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      type: category.type,
    })),
  };
}
