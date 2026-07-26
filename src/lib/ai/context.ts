import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Financial snapshot assembled for the AI assistant. Everything is computed
 * from the user's transactions in a single pass and rendered as a compact,
 * token-efficient text block for the system prompt.
 */

export interface MonthSummary {
  /** e.g. "2026-07" */
  key: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  /** True for the current, still-running month. */
  partial: boolean;
}

export interface CategorySpend {
  name: string;
  last3Months: number;
  last12Months: number;
}

export interface CounterpartySpend {
  name: string;
  total: number;
  count: number;
}

export interface LargeExpense {
  date: string;
  description: string;
  counterparty: string | null;
  category: string;
  amount: number;
}

export interface RecurringPattern {
  label: string;
  category: string;
  averageAmount: number;
  timesSeen: number;
  monthsSeen: number;
  cadence: "weekly" | "monthly" | "irregular";
}

export interface ForecastMonth {
  label: string;
  projectedIncome: number;
  projectedExpenses: number;
  projectedNet: number;
  projectedBalance: number;
}

export interface UnusualTransaction {
  date: string;
  description: string;
  category: string;
  amount: number;
  typicalAmount: number;
  zScore: number;
}

export interface FinancialSnapshot {
  currency: string;
  generatedAt: string;
  currentBalance: number;
  transactionCount: number;
  months: MonthSummary[];
  categorySpend: CategorySpend[];
  topCounterparties: CounterpartySpend[];
  largestExpenses: LargeExpense[];
  recurring: RecurringPattern[];
  forecast: ForecastMonth[];
  unusual: UnusualTransaction[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normalizes a merchant/description string so recurring payments group together. */
function normalizeMerchant(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Least-squares slope+intercept over y indexed 0..n-1. */
function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] };
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

/* ------------------------------------------------------------------ */
/* Snapshot builder                                                    */
/* ------------------------------------------------------------------ */

const WINDOW_MONTHS = 12;

export async function buildFinancialSnapshot(
  userId: string,
  currency: string
): Promise<FinancialSnapshot> {
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (WINDOW_MONTHS - 1), 1)
  );

  const [transactions, priorRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: windowStart } },
      orderBy: { date: "asc" },
      select: {
        type: true,
        amount: true,
        description: true,
        counterparty: true,
        date: true,
        category: { select: { name: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { userId, date: { lt: windowStart } },
      select: { type: true, amount: true },
    }),
  ]);

  const priorNet = priorRows.reduce(
    (sum, row) => sum + (row.type === "INCOME" ? Number(row.amount) : -Number(row.amount)),
    0
  );

  /* ---- Monthly summaries (full 12-month axis) ---- */
  const currentKey = monthKeyOf(now);
  const months: MonthSummary[] = [];
  const monthIndex = new Map<string, MonthSummary>();
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKeyOf(d);
    const summary: MonthSummary = {
      key,
      label: monthLabelOf(d),
      income: 0,
      expenses: 0,
      net: 0,
      partial: key === currentKey,
    };
    months.push(summary);
    monthIndex.set(key, summary);
  }

  /* ---- Single pass over transactions ---- */
  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const categoryTotals = new Map<string, { last3: number; last12: number }>();
  const counterpartyTotals = new Map<string, { name: string; total: number; count: number }>();
  const merchantGroups = new Map<
    string,
    { label: string; category: string; amounts: number[]; monthKeys: Set<string>; dates: Date[] }
  >();
  const categoryAmounts = new Map<string, number[]>();
  const recentExpenses: {
    date: Date;
    description: string;
    counterparty: string | null;
    category: string;
    amount: number;
  }[] = [];
  let windowNet = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const signed = tx.type === "INCOME" ? amount : -amount;
    windowNet += signed;

    const summary = monthIndex.get(monthKeyOf(tx.date));
    if (summary) {
      if (tx.type === "INCOME") summary.income += amount;
      else summary.expenses += amount;
      summary.net += signed;
    }

    if (tx.type !== "EXPENSE") continue;

    const categoryName = tx.category?.name ?? "Uncategorized";

    const categoryEntry = categoryTotals.get(categoryName) ?? { last3: 0, last12: 0 };
    categoryEntry.last12 += amount;
    if (tx.date >= threeMonthsAgo) categoryEntry.last3 += amount;
    categoryTotals.set(categoryName, categoryEntry);

    const counterpartyName = (tx.counterparty ?? "").trim();
    if (counterpartyName) {
      const key = counterpartyName.toLowerCase();
      const entry = counterpartyTotals.get(key) ?? { name: counterpartyName, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      counterpartyTotals.set(key, entry);
    }

    const merchantKey = normalizeMerchant(counterpartyName || tx.description);
    if (merchantKey.length >= 3) {
      const group = merchantGroups.get(merchantKey) ?? {
        label: counterpartyName || tx.description,
        category: categoryName,
        amounts: [],
        monthKeys: new Set<string>(),
        dates: [],
      };
      group.amounts.push(amount);
      group.monthKeys.add(monthKeyOf(tx.date));
      group.dates.push(tx.date);
      merchantGroups.set(merchantKey, group);
    }

    const amounts = categoryAmounts.get(categoryName) ?? [];
    amounts.push(amount);
    categoryAmounts.set(categoryName, amounts);

    if (tx.date >= ninetyDaysAgo) {
      recentExpenses.push({
        date: tx.date,
        description: tx.description,
        counterparty: tx.counterparty,
        category: categoryName,
        amount,
      });
    }
  }

  const currentBalance = round2(priorNet + windowNet);

  /* ---- Category spend ---- */
  const categorySpend: CategorySpend[] = [...categoryTotals.entries()]
    .map(([name, totals]) => ({
      name,
      last3Months: round2(totals.last3),
      last12Months: round2(totals.last12),
    }))
    .sort((a, b) => b.last12Months - a.last12Months)
    .slice(0, 12);

  /* ---- Top counterparties ---- */
  const topCounterparties: CounterpartySpend[] = [...counterpartyTotals.values()]
    .map((entry) => ({ name: entry.name, total: round2(entry.total), count: entry.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  /* ---- Largest recent expenses ---- */
  const largestExpenses: LargeExpense[] = [...recentExpenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((tx) => ({
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      counterparty: tx.counterparty,
      category: tx.category,
      amount: round2(tx.amount),
    }));

  /* ---- Recurring patterns ---- */
  const recurring: RecurringPattern[] = [];
  for (const group of merchantGroups.values()) {
    if (group.amounts.length < 3 || group.monthKeys.size < 3) continue;
    const average = mean(group.amounts);
    if (average <= 0) continue;
    const spread = stdDev(group.amounts, average);
    if (spread / average > 0.35) continue; // amounts vary too much to be a subscription-like pattern

    const perMonth = group.amounts.length / group.monthKeys.size;
    recurring.push({
      label: group.label,
      category: group.category,
      averageAmount: round2(average),
      timesSeen: group.amounts.length,
      monthsSeen: group.monthKeys.size,
      cadence: perMonth >= 3.5 ? "weekly" : perMonth <= 1.5 ? "monthly" : "irregular",
    });
  }
  recurring.sort((a, b) => b.averageAmount - a.averageAmount);
  const topRecurring = recurring.slice(0, 12);

  /* ---- Forecast (trend over full months, current month excluded) ---- */
  const fullMonths = months.filter((month) => !month.partial);
  const trendWindow = fullMonths.slice(-6).filter((m) => m.income > 0 || m.expenses > 0);
  const forecast: ForecastMonth[] = [];
  if (trendWindow.length >= 2) {
    const incomeTrend = linearTrend(trendWindow.map((m) => m.income));
    const expenseTrend = linearTrend(trendWindow.map((m) => m.expenses));
    let runningBalance = currentBalance;
    for (let step = 0; step < 3; step++) {
      const x = trendWindow.length + step;
      const projectedIncome = Math.max(0, incomeTrend.intercept + incomeTrend.slope * x);
      const projectedExpenses = Math.max(0, expenseTrend.intercept + expenseTrend.slope * x);
      const projectedNet = projectedIncome - projectedExpenses;
      runningBalance += projectedNet;
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + step, 1));
      forecast.push({
        label: monthLabelOf(d),
        projectedIncome: round2(projectedIncome),
        projectedExpenses: round2(projectedExpenses),
        projectedNet: round2(projectedNet),
        projectedBalance: round2(runningBalance),
      });
    }
  }

  /* ---- Unusual transactions (z-score vs category norm) ---- */
  const categoryStats = new Map<string, { average: number; spread: number; count: number }>();
  for (const [name, amounts] of categoryAmounts) {
    if (amounts.length < 5) continue;
    const average = mean(amounts);
    const spread = stdDev(amounts, average);
    if (spread <= 0) continue;
    categoryStats.set(name, { average, spread, count: amounts.length });
  }

  const unusual: UnusualTransaction[] = recentExpenses
    .flatMap((tx) => {
      const stats = categoryStats.get(tx.category);
      if (!stats) return [];
      const zScore = (tx.amount - stats.average) / stats.spread;
      if (zScore < 2.5) return [];
      return [
        {
          date: tx.date.toISOString().slice(0, 10),
          description: tx.description,
          category: tx.category,
          amount: round2(tx.amount),
          typicalAmount: round2(stats.average),
          zScore: Math.round(zScore * 10) / 10,
        },
      ];
    })
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, 8);

  return {
    currency,
    generatedAt: now.toISOString().slice(0, 10),
    currentBalance,
    transactionCount: transactions.length,
    months: months.map((month) => ({
      ...month,
      income: round2(month.income),
      expenses: round2(month.expenses),
      net: round2(month.net),
    })),
    categorySpend,
    topCounterparties,
    largestExpenses,
    recurring: topRecurring,
    forecast,
    unusual,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function money(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Renders the snapshot as a compact plain-text block for the system prompt. */
export function renderSnapshot(snapshot: FinancialSnapshot): string {
  const lines: string[] = [];

  lines.push(
    `As of ${snapshot.generatedAt} | currency: ${snapshot.currency} | current balance: ${money(snapshot.currentBalance)} | transactions in last 12 months: ${snapshot.transactionCount}`
  );

  lines.push("", "MONTHLY SUMMARY (income / expenses / net):");
  for (const month of snapshot.months) {
    if (month.income === 0 && month.expenses === 0) continue;
    lines.push(
      `${month.label}${month.partial ? " (month in progress)" : ""}: ${money(month.income)} / ${money(month.expenses)} / ${money(month.net)}`
    );
  }

  if (snapshot.categorySpend.length > 0) {
    lines.push("", "SPENDING BY CATEGORY (last 3 months / last 12 months):");
    for (const category of snapshot.categorySpend) {
      lines.push(`${category.name}: ${money(category.last3Months)} / ${money(category.last12Months)}`);
    }
  }

  if (snapshot.topCounterparties.length > 0) {
    lines.push("", "TOP COUNTERPARTIES / SUPPLIERS BY SPEND (last 12 months):");
    for (const supplier of snapshot.topCounterparties) {
      lines.push(`${supplier.name}: ${money(supplier.total)} across ${supplier.count} payments`);
    }
  }

  if (snapshot.largestExpenses.length > 0) {
    lines.push("", "LARGEST EXPENSES (last 90 days):");
    for (const expense of snapshot.largestExpenses) {
      lines.push(
        `${expense.date} ${money(expense.amount)} ${expense.category} — ${expense.description}${expense.counterparty ? ` (${expense.counterparty})` : ""}`
      );
    }
  }

  if (snapshot.recurring.length > 0) {
    lines.push("", "RECURRING PAYMENT PATTERNS:");
    for (const pattern of snapshot.recurring) {
      lines.push(
        `${pattern.label} (${pattern.category}): ~${money(pattern.averageAmount)} ${pattern.cadence}, seen ${pattern.timesSeen}x over ${pattern.monthsSeen} months`
      );
    }
  }

  if (snapshot.forecast.length > 0) {
    lines.push(
      "",
      "CASH FORECAST (simple linear trend over recent full months — an estimate, not a guarantee):"
    );
    for (const month of snapshot.forecast) {
      lines.push(
        `${month.label}: income ~${money(month.projectedIncome)}, expenses ~${money(month.projectedExpenses)}, net ~${money(month.projectedNet)}, projected balance ~${money(month.projectedBalance)}`
      );
    }
  } else {
    lines.push("", "CASH FORECAST: not enough monthly history to project a trend yet.");
  }

  if (snapshot.unusual.length > 0) {
    lines.push("", "STATISTICALLY UNUSUAL TRANSACTIONS (last 90 days, z-score >= 2.5 vs category norm):");
    for (const tx of snapshot.unusual) {
      lines.push(
        `${tx.date} ${money(tx.amount)} ${tx.category} — ${tx.description} (typical ${tx.category} amount ~${money(tx.typicalAmount)}, z=${tx.zScore})`
      );
    }
  }

  return lines.join("\n");
}
