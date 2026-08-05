import "server-only";

import { loadCashPosition } from "@/lib/finance/cash-data";
import { mapAssumptionRow } from "@/lib/finance/data";
import { computeForecast, type AssumptionInput, type ForecastResult } from "@/lib/finance/forecast";
import { detectRecurring, type FinanceTransaction, type RecurringItem } from "@/lib/finance/recurrence";
import { summarizeDetectedCharges } from "@/lib/finance/recurring-spend";
import { renderForecastText } from "@/lib/finance/render";
import { ASSET_KIND_LABELS } from "@/lib/personal/net-worth";
import { loadNetWorthSnapshot, type NetWorthSnapshot } from "@/lib/personal/net-worth-data";
import { prisma } from "@/lib/prisma";

/**
 * Financial snapshot assembled for the AI assistant. Aggregations are
 * computed from the user's transactions; forecasting, recurrence detection
 * and assumptions come from the shared engine in src/lib/finance.
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

/**
 * A recurring charge whose price has risen since the first charge in the
 * window. The recurring charges themselves are already in the snapshot (the
 * forecast section lists each one with its cadence and monthly cost), but only
 * as an average — so without this the model can see that a vendor costs €54 a
 * month and not that it used to cost €39, which is the part a user asks about.
 */
export interface RecurringPriceRise {
  label: string;
  category: string;
  /** Amount of the earliest charge in the window. */
  from: number;
  /** Amount of the most recent charge. */
  to: number;
  /** Rise as a percentage of `from`. */
  percent: number;
  lastChargedAt: string;
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
  recurring: RecurringItem[];
  recurringPriceRises: RecurringPriceRise[];
  forecast: ForecastResult;
  assumptions: AssumptionInput[];
  unusual: UnusualTransaction[];
  /**
   * Net worth, or null when the workspace tracks no holdings — which is every
   * Business workspace, since the feature is Personal-only. Null leaves the
   * section out of the prompt entirely rather than spending tokens restating
   * the cash balance under a second heading.
   */
  netWorth: NetWorthSnapshot | null;
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

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/* ------------------------------------------------------------------ */
/* Snapshot builder                                                    */
/* ------------------------------------------------------------------ */

const WINDOW_MONTHS = 12;

export async function buildFinancialSnapshot(
  workspaceId: string,
  currency: string
): Promise<FinancialSnapshot> {
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (WINDOW_MONTHS - 1), 1)
  );

  const [rows, priorRows, assumptionRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: windowStart } },
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
      where: { workspaceId, date: { lt: windowStart } },
      select: { type: true, amount: true },
    }),
    prisma.assumption.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
  ]);

  const transactions: FinanceTransaction[] = rows.map((row) => ({
    type: row.type,
    amount: Number(row.amount),
    date: row.date,
    description: row.description,
    counterparty: row.counterparty,
    category: row.category?.name ?? "Uncategorized",
  }));

  const priorNet = priorRows.reduce(
    (sum, row) => sum + (row.type === "INCOME" ? Number(row.amount) : -Number(row.amount)),
    0
  );

  const assumptions: AssumptionInput[] = assumptionRows.map(mapAssumptionRow);

  const windowNet = transactions.reduce(
    (sum, tx) => sum + (tx.type === "INCOME" ? tx.amount : -tx.amount),
    0
  );
  const cash = await loadCashPosition(workspaceId, currency, priorNet + windowNet);

  const forecast = computeForecast({
    transactions,
    priorNet,
    assumptions,
    currency,
    now,
    startingBalance: cash.source === "bank" ? cash.total : null,
  });

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

  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const categoryTotals = new Map<string, { last3: number; last12: number }>();
  const counterpartyTotals = new Map<string, { name: string; total: number; count: number }>();
  const categoryAmounts = new Map<string, number[]>();
  const recentExpenses: {
    date: Date;
    description: string;
    counterparty: string | null;
    category: string;
    amount: number;
  }[] = [];

  for (const tx of transactions) {
    const summary = monthIndex.get(monthKeyOf(tx.date));
    if (summary) {
      const signed = tx.type === "INCOME" ? tx.amount : -tx.amount;
      if (tx.type === "INCOME") summary.income += tx.amount;
      else summary.expenses += tx.amount;
      summary.net += signed;
    }

    if (tx.type !== "EXPENSE") continue;

    const categoryEntry = categoryTotals.get(tx.category) ?? { last3: 0, last12: 0 };
    categoryEntry.last12 += tx.amount;
    if (tx.date >= threeMonthsAgo) categoryEntry.last3 += tx.amount;
    categoryTotals.set(tx.category, categoryEntry);

    const counterpartyName = (tx.counterparty ?? "").trim();
    if (counterpartyName) {
      const key = counterpartyName.toLowerCase();
      const entry = counterpartyTotals.get(key) ?? { name: counterpartyName, total: 0, count: 0 };
      entry.total += tx.amount;
      entry.count += 1;
      counterpartyTotals.set(key, entry);
    }

    const amounts = categoryAmounts.get(tx.category) ?? [];
    amounts.push(tx.amount);
    categoryAmounts.set(tx.category, amounts);

    if (tx.date >= ninetyDaysAgo) {
      recentExpenses.push({
        date: tx.date,
        description: tx.description,
        counterparty: tx.counterparty,
        category: tx.category,
        amount: tx.amount,
      });
    }
  }

  const categorySpend: CategorySpend[] = [...categoryTotals.entries()]
    .map(([name, totals]) => ({
      name,
      last3Months: round2(totals.last3),
      last12Months: round2(totals.last12),
    }))
    .sort((a, b) => b.last12Months - a.last12Months)
    .slice(0, 12);

  const topCounterparties: CounterpartySpend[] = [...counterpartyTotals.values()]
    .map((entry) => ({ name: entry.name, total: round2(entry.total), count: entry.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

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

  /* ---- Unusual transactions (z-score vs category norm) ---- */
  const categoryStats = new Map<string, { average: number; spread: number }>();
  for (const [name, amounts] of categoryAmounts) {
    if (amounts.length < 5) continue;
    const average = mean(amounts);
    const spread = stdDev(amounts, average);
    if (spread <= 0) continue;
    categoryStats.set(name, { average, spread });
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

  /* ---- Recurring charges whose price moved ---- */
  // Detection runs once and both the raw items and the price comparison are
  // derived from it. Stopped charges are left out: a vendor that raised its
  // price and then stopped billing is not something to act on.
  const recurring = detectRecurring(transactions);
  const recurringPriceRises: RecurringPriceRise[] = summarizeDetectedCharges(
    recurring,
    transactions,
    now
  )
    .flatMap((charge) => {
      const change = charge.priceChange;
      if (charge.overdue || change === null || change.to <= change.from) return [];
      return [
        {
          label: charge.label,
          category: charge.category,
          from: change.from,
          to: change.to,
          percent: change.percent,
          lastChargedAt: charge.lastChargedAt,
        },
      ];
    })
    .slice(0, 8);

  /* ---- Net worth (Personal; null when nothing is tracked) ---- */
  // Reuses the monthly nets already accumulated above, so grounding the model
  // in net worth costs one query for the holdings and nothing else.
  const netWorth = await loadNetWorthSnapshot({
    workspaceId,
    currency,
    months: months.map((month) => ({ month: month.key, net: month.net })),
    openingBalance: priorNet,
    cashAnchor: cash.source === "bank" ? cash.total : null,
    cash: cash.total,
  });

  return {
    currency,
    generatedAt: now.toISOString().slice(0, 10),
    currentBalance: forecast.currentBalance,
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
    recurring,
    recurringPriceRises,
    forecast,
    assumptions,
    unusual,
    netWorth,
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

  if (snapshot.netWorth) {
    const netWorth = snapshot.netWorth;
    lines.push(
      "",
      "NET WORTH (assets and debts the user tracks by hand, plus bank cash):",
      `now: ${money(netWorth.total)} = assets ${money(netWorth.assetTotal)} + cash ${money(netWorth.cash)} − debts ${money(netWorth.liabilityTotal)}`
    );
    if (netWorth.largestAssets.length > 0) {
      lines.push(
        `largest assets: ${netWorth.largestAssets
          .map((asset) => `${asset.name} (${ASSET_KIND_LABELS[asset.kind]}) ${money(asset.value)}`)
          .join("; ")}`
      );
    }
    if (netWorth.trend.length > 1) {
      lines.push(
        `trend: ${netWorth.trend.map((point) => `${point.label} ${money(point.netWorth)}`).join(" | ")}`
      );
    }
    if (netWorth.otherCurrencyCount > 0) {
      lines.push(
        `note: ${netWorth.otherCurrencyCount} holding(s) are held in another currency and excluded from every figure above — there are no exchange rates in this app.`
      );
    }
  }

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

  if (snapshot.recurringPriceRises.length > 0) {
    lines.push(
      "",
      "RECURRING CHARGES WHOSE PRICE HAS RISEN (first charge in the window vs the latest):"
    );
    for (const rise of snapshot.recurringPriceRises) {
      lines.push(
        `${rise.label} (${rise.category}): ${money(rise.from)} -> ${money(rise.to)}, up ${rise.percent}%, last charged ${rise.lastChargedAt}`
      );
    }
  }

  if (snapshot.unusual.length > 0) {
    lines.push("", "STATISTICALLY UNUSUAL TRANSACTIONS (last 90 days, z-score >= 2.5 vs category norm):");
    for (const tx of snapshot.unusual) {
      lines.push(
        `${tx.date} ${money(tx.amount)} ${tx.category} — ${tx.description} (typical ${tx.category} amount ~${money(tx.typicalAmount)}, z=${tx.zScore})`
      );
    }
  }

  lines.push("", "CASH FORECAST, RUNWAY, RECURRING FLOWS AND USER ASSUMPTIONS:");
  lines.push(renderForecastText(snapshot.forecast, snapshot.assumptions));

  return lines.join("\n");
}
