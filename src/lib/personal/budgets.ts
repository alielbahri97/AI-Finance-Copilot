/**
 * Budget arithmetic — pure logic, no database, no Prisma types.
 *
 * A budget is a spending cap for one category in one calendar month. With
 * `rollover` on, what a month did not spend increases the next month's
 * available amount, and what it overspent reduces it: envelope budgeting,
 * where the envelope is not silently refilled every month.
 *
 * Route handlers read rows and category spend from the database and hand both
 * to `summarizeBudgets`, which is where every number the UI shows comes from.
 */

/** Fraction of the available amount at which a budget starts warning. */
export const BUDGET_WARNING_RATIO = 0.85;

/**
 * How many months a rollover chain may walk back. The chain normally ends on
 * its own at the first month with no budget row; this only bounds the work
 * for a category budgeted every month for years.
 */
export const MAX_ROLLOVER_MONTHS = 24;

/**
 * Range a stored or requested year may fall in. Wide enough for backdated
 * history and forward planning, narrow enough that a mistyped URL or payload
 * cannot ask for a hundred-thousand-year window.
 */
export const MIN_BUDGET_YEAR = 2000;
export const MAX_BUDGET_YEAR = 2100;

export interface BudgetPeriod {
  year: number;
  /** 1–12, matching the stored column rather than JavaScript's 0-based month. */
  month: number;
}

export interface BudgetRow extends BudgetPeriod {
  id: string;
  /** Category name — the key budgets are stored and looked up by. */
  category: string;
  categoryId: string | null;
  limit: number;
  rollover: boolean;
}

export type BudgetStatus = "under" | "warning" | "over";

export interface BudgetProgress extends BudgetPeriod {
  id: string;
  category: string;
  categoryId: string | null;
  /** This month's own cap, as entered. */
  limit: number;
  rollover: boolean;
  /**
   * Brought in from previous months: positive when they underspent, negative
   * when they overspent. Always 0 when rollover is off.
   */
  carriedOver: number;
  /** What may actually be spent this month: `limit + carriedOver`. */
  available: number;
  spent: number;
  /** Left to spend. Negative means over budget by that much. */
  remaining: number;
  /** Spent as a fraction of available, for the progress bar. 0 when available <= 0. */
  ratio: number;
  status: BudgetStatus;
}

export interface BudgetSummary extends BudgetPeriod {
  budgets: BudgetProgress[];
  /** Sum of the months' own caps, ignoring rollover. */
  totalLimit: number;
  /** Sum of what may be spent, rollover included. */
  totalAvailable: number;
  totalSpent: number;
  totalRemaining: number;
  overCount: number;
  /** Total spent as a fraction of total available. */
  ratio: number;
}

/** Stable "YYYY-MM" key for spend lookups. */
export function monthKey(period: BudgetPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

export function previousMonth(period: BudgetPeriod): BudgetPeriod {
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 };
}

export function nextMonth(period: BudgetPeriod): BudgetPeriod {
  return period.month === 12
    ? { year: period.year + 1, month: 1 }
    : { year: period.year, month: period.month + 1 };
}

/** Moves a period by whole months, forwards or backwards, across year ends. */
export function shiftMonths(period: BudgetPeriod, delta: number): BudgetPeriod {
  const index = period.year * 12 + (period.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Reads a period out of untrusted `?year=&month=` parameters, falling back
 * per field so a half-written URL still lands on a real month.
 */
export function parsePeriod(
  rawYear: string | undefined,
  rawMonth: string | undefined,
  fallback: BudgetPeriod
): BudgetPeriod {
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const yearOk = Number.isInteger(year) && year >= MIN_BUDGET_YEAR && year <= MAX_BUDGET_YEAR;
  const monthOk = Number.isInteger(month) && month >= 1 && month <= 12;
  return { year: yearOk ? year : fallback.year, month: monthOk ? month : fallback.month };
}

/** "August 2026", for headings and month navigation. */
export function monthLabel(period: BudgetPeriod): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(periodRange(period).start);
}

/** The month a date falls in, in the stored 1–12 form. */
export function periodOf(date: Date): BudgetPeriod {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Half-open [start, end) UTC bounds of a month, for date-range queries. */
export function periodRange(period: BudgetPeriod): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(period.year, period.month - 1, 1)),
    end: new Date(Date.UTC(period.year, period.month, 1)),
  };
}

/** Key for the category-spend map: category name plus month. */
export function spendKey(category: string, period: BudgetPeriod): string {
  return `${category}|${monthKey(period)}`;
}

/** Spend per category per month, keyed by `spendKey`. */
export type SpendLookup = ReadonlyMap<string, number>;

function spendFor(spend: SpendLookup, category: string, period: BudgetPeriod): number {
  return spend.get(spendKey(category, period)) ?? 0;
}

export function budgetStatus(spent: number, available: number): BudgetStatus {
  if (spent > available) return "over";
  if (available > 0 && spent / available >= BUDGET_WARNING_RATIO) return "warning";
  return "under";
}

/**
 * What earlier months hand to `period` for one category.
 *
 * Walks back month by month and stops at the first month with no budget row,
 * or with rollover switched off — a month that does not roll over is where a
 * chain starts, so nothing before it can reach past it. Each step's surplus is
 * `limit + carriedIn - spent`, which is what makes a run of small underspends
 * accumulate and an overspend eat into the following month.
 */
export function carryoverFor(
  rows: readonly BudgetRow[],
  spend: SpendLookup,
  category: string,
  period: BudgetPeriod
): number {
  const byMonth = new Map<string, BudgetRow>();
  for (const row of rows) {
    if (row.category === category) byMonth.set(monthKey(row), row);
  }

  // Collect the unbroken run of rollover months immediately before `period`.
  const chain: BudgetRow[] = [];
  let cursor = previousMonth(period);
  for (let step = 0; step < MAX_ROLLOVER_MONTHS; step += 1) {
    const row = byMonth.get(monthKey(cursor));
    if (!row || !row.rollover) break;
    chain.push(row);
    cursor = previousMonth(cursor);
  }

  // Replay it oldest-first so each month's surplus feeds the next.
  let carried = 0;
  for (const row of chain.reverse()) {
    carried = row.limit + carried - spendFor(spend, category, row);
  }
  return carried;
}

/** Progress for one budget row, with rollover resolved from its own history. */
export function budgetProgress(
  row: BudgetRow,
  rows: readonly BudgetRow[],
  spend: SpendLookup
): BudgetProgress {
  const period = { year: row.year, month: row.month };
  const carriedOver = row.rollover ? carryoverFor(rows, spend, row.category, period) : 0;
  const available = row.limit + carriedOver;
  const spent = spendFor(spend, row.category, period);

  return {
    id: row.id,
    category: row.category,
    categoryId: row.categoryId,
    year: row.year,
    month: row.month,
    limit: row.limit,
    rollover: row.rollover,
    carriedOver,
    available,
    spent,
    remaining: available - spent,
    ratio: available > 0 ? spent / available : 0,
    status: budgetStatus(spent, available),
  };
}

/**
 * Every budget for one month, plus the totals the dashboard widget shows.
 *
 * `rows` should include earlier months too: a rollover budget cannot be
 * resolved without the history it carries forward from.
 */
export function summarizeBudgets(
  rows: readonly BudgetRow[],
  spend: SpendLookup,
  target: BudgetPeriod
): BudgetSummary {
  const budgets = rows
    .filter((row) => row.year === target.year && row.month === target.month)
    .map((row) => budgetProgress(row, rows, spend))
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));

  const totalLimit = budgets.reduce((sum, b) => sum + b.limit, 0);
  const totalAvailable = budgets.reduce((sum, b) => sum + b.available, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);

  return {
    year: target.year,
    month: target.month,
    budgets,
    totalLimit,
    totalAvailable,
    totalSpent,
    totalRemaining: totalAvailable - totalSpent,
    overCount: budgets.filter((b) => b.status === "over").length,
    ratio: totalAvailable > 0 ? totalSpent / totalAvailable : 0,
  };
}
