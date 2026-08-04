import "server-only";

import { resolveReportCash } from "@/lib/finance/cash";
import { loadCashPosition } from "@/lib/finance/cash-data";
import { prisma } from "@/lib/prisma";

import { previousPeriod, type ResolvedPeriod } from "./period";

/**
 * Executive report builder: KPIs with period-over-period deltas, monthly and
 * yearly trends, category breakdowns, top vendors/customers, and AR/AP aging.
 * One implementation feeds the /reports page and every export format.
 */

export interface ReportKpis {
  revenue: number;
  expenses: number;
  profit: number;
  /** Profit as % of revenue; null when there is no revenue. */
  marginPct: number | null;
  /** Cash balance at the end of the period (all transactions up to `to`). */
  cash: number;
  /** Whether `cash` came from the connected banks or from the transactions. */
  cashSource: "bank" | "transactions";
  /** Unpaid receivable invoices — money owed to the user. */
  accountsReceivable: number;
  /** Unpaid payable invoices — bills the user owes. */
  accountsPayable: number;
  revenueChangePct: number | null;
  expensesChangePct: number | null;
  profitChangePct: number | null;
  marginPrevPct: number | null;
}

export interface MonthTrend {
  key: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface YearTrend {
  year: number;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface CategoryTotal {
  name: string;
  color: string;
  total: number;
}

export interface PartyTotal {
  name: string;
  total: number;
  count: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  total: number;
}

export interface ReportData {
  currency: string;
  generatedAt: string;
  period: { preset: string; label: string; from: string; to: string };
  kpis: ReportKpis;
  monthly: MonthTrend[];
  yearly: YearTrend[];
  incomeCategories: CategoryTotal[];
  expenseCategories: CategoryTotal[];
  topVendors: PartyTotal[];
  topCustomers: PartyTotal[];
  arAging: AgingBucket[];
  apAging: AgingBucket[];
}

export interface ReportTransaction {
  date: string;
  type: "INCOME" | "EXPENSE";
  description: string;
  counterparty: string | null;
  category: string;
  amount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AGING_BUCKETS = ["Current", "1–30 days", "31–60 days", "60+ days"] as const;
const FALLBACK_COLOR = "#94a3b8";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function buildReport(
  workspaceId: string,
  currency: string,
  period: ResolvedPeriod
): Promise<ReportData> {
  const previous = previousPeriod(period);

  const [rows, previousAggregates, priorRows, allRows, unpaidInvoices] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: period.from, lte: period.to } },
      select: {
        type: true,
        amount: true,
        date: true,
        counterparty: true,
        category: { select: { name: true, color: true } },
      },
    }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: { workspaceId, date: { gte: previous.from, lte: previous.to } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: { workspaceId, date: { lt: period.from } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { workspaceId },
      select: { type: true, amount: true, date: true },
    }),
    prisma.invoice.findMany({
      where: { workspaceId, status: "UNPAID" },
      select: { direction: true, dueDate: true, total: true },
    }),
  ]);

  /* ---- KPIs ---- */
  let revenue = 0;
  let expenses = 0;
  for (const row of rows) {
    if (row.type === "INCOME") revenue += Number(row.amount);
    else expenses += Number(row.amount);
  }
  const profit = revenue - expenses;

  const prevRevenue = Number(
    previousAggregates.find((entry) => entry.type === "INCOME")?._sum.amount ?? 0
  );
  const prevExpenses = Number(
    previousAggregates.find((entry) => entry.type === "EXPENSE")?._sum.amount ?? 0
  );
  const prevProfit = prevRevenue - prevExpenses;

  const priorNet = priorRows.reduce(
    (sum, entry) =>
      sum + (entry.type === "INCOME" ? Number(entry._sum.amount ?? 0) : -Number(entry._sum.amount ?? 0)),
    0
  );
  // A period that runs up to today closes on the banks' own figure (aggregated
  // across included accounts); historical periods keep their transaction close.
  const allTimeNet = allRows.reduce(
    (sum, row) => sum + (row.type === "INCOME" ? Number(row.amount) : -Number(row.amount)),
    0
  );
  const cashPosition = await loadCashPosition(workspaceId, currency, allTimeNet);
  const { cash, source: cashSource } = resolveReportCash({
    transactionCash: priorNet + profit,
    bankCash: cashPosition.source === "bank" ? cashPosition.total : null,
    periodEnd: period.to,
    now: new Date(),
  });

  /* ---- AR / AP + aging ---- */
  const now = Date.now();
  const arBuckets = AGING_BUCKETS.map((label) => ({ label, count: 0, total: 0 }));
  const apBuckets = AGING_BUCKETS.map((label) => ({ label, count: 0, total: 0 }));
  let accountsReceivable = 0;
  let accountsPayable = 0;

  for (const invoice of unpaidInvoices) {
    const total = Number(invoice.total);
    const overdueDays = invoice.dueDate
      ? Math.floor((now - invoice.dueDate.getTime()) / MS_PER_DAY)
      : 0;
    const bucketIndex =
      overdueDays <= 0 ? 0 : overdueDays <= 30 ? 1 : overdueDays <= 60 ? 2 : 3;
    if (invoice.direction === "RECEIVABLE") {
      accountsReceivable += total;
      arBuckets[bucketIndex].count += 1;
      arBuckets[bucketIndex].total += total;
    } else {
      accountsPayable += total;
      apBuckets[bucketIndex].count += 1;
      apBuckets[bucketIndex].total += total;
    }
  }

  /* ---- Monthly trend across the period ---- */
  const monthly: MonthTrend[] = [];
  const monthIndex = new Map<string, MonthTrend>();
  for (
    let cursor = new Date(Date.UTC(period.from.getUTCFullYear(), period.from.getUTCMonth(), 1));
    cursor <= period.to;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  ) {
    const entry: MonthTrend = {
      key: monthKeyOf(cursor),
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
    monthly.push(entry);
    monthIndex.set(entry.key, entry);
  }

  /* ---- Categories and counterparties within the period ---- */
  const incomeCategoryTotals = new Map<string, CategoryTotal>();
  const expenseCategoryTotals = new Map<string, CategoryTotal>();
  const vendorTotals = new Map<string, PartyTotal>();
  const customerTotals = new Map<string, PartyTotal>();

  for (const row of rows) {
    const amount = Number(row.amount);
    const monthEntry = monthIndex.get(monthKeyOf(row.date));
    if (monthEntry) {
      if (row.type === "INCOME") monthEntry.revenue += amount;
      else monthEntry.expenses += amount;
      monthEntry.profit = monthEntry.revenue - monthEntry.expenses;
    }

    const categoryName = row.category?.name ?? "Uncategorized";
    const categoryMap = row.type === "INCOME" ? incomeCategoryTotals : expenseCategoryTotals;
    const categoryEntry = categoryMap.get(categoryName) ?? {
      name: categoryName,
      color: row.category?.color ?? FALLBACK_COLOR,
      total: 0,
    };
    categoryEntry.total += amount;
    categoryMap.set(categoryName, categoryEntry);

    const party = (row.counterparty ?? "").trim();
    if (party) {
      const partyMap = row.type === "INCOME" ? customerTotals : vendorTotals;
      const key = party.toLowerCase();
      const partyEntry = partyMap.get(key) ?? { name: party, total: 0, count: 0 };
      partyEntry.total += amount;
      partyEntry.count += 1;
      partyMap.set(key, partyEntry);
    }
  }

  /* ---- Yearly trend (all history) ---- */
  const yearTotals = new Map<number, YearTrend>();
  for (const row of allRows) {
    const yearOf = row.date.getUTCFullYear();
    const entry = yearTotals.get(yearOf) ?? { year: yearOf, revenue: 0, expenses: 0, profit: 0 };
    if (row.type === "INCOME") entry.revenue += Number(row.amount);
    else entry.expenses += Number(row.amount);
    entry.profit = entry.revenue - entry.expenses;
    yearTotals.set(yearOf, entry);
  }
  const yearly = [...yearTotals.values()]
    .sort((a, b) => a.year - b.year)
    .slice(-5)
    .map((entry) => ({
      year: entry.year,
      revenue: round2(entry.revenue),
      expenses: round2(entry.expenses),
      profit: round2(entry.profit),
    }));

  const sortTotals = <T extends { total: number }>(map: Map<string, T>, limit: number) =>
    [...map.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map((entry) => ({ ...entry, total: round2(entry.total) }));

  return {
    currency,
    generatedAt: isoDay(new Date()),
    period: {
      preset: period.preset,
      label: period.label,
      from: isoDay(period.from),
      to: isoDay(period.to),
    },
    kpis: {
      revenue: round2(revenue),
      expenses: round2(expenses),
      profit: round2(profit),
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      cash: round2(cash),
      cashSource,
      accountsReceivable: round2(accountsReceivable),
      accountsPayable: round2(accountsPayable),
      revenueChangePct: changePct(revenue, prevRevenue),
      expensesChangePct: changePct(expenses, prevExpenses),
      profitChangePct: changePct(profit, prevProfit),
      marginPrevPct: prevRevenue > 0 ? Math.round((prevProfit / prevRevenue) * 1000) / 10 : null,
    },
    monthly: monthly.map((entry) => ({
      ...entry,
      revenue: round2(entry.revenue),
      expenses: round2(entry.expenses),
      profit: round2(entry.profit),
    })),
    yearly,
    incomeCategories: sortTotals(incomeCategoryTotals, 10),
    expenseCategories: sortTotals(expenseCategoryTotals, 10),
    topVendors: sortTotals(vendorTotals, 10),
    topCustomers: sortTotals(customerTotals, 10),
    arAging: arBuckets.map((bucket) => ({ ...bucket, total: round2(bucket.total) })),
    apAging: apBuckets.map((bucket) => ({ ...bucket, total: round2(bucket.total) })),
  };
}

/** Transactions in the period, for the CSV/Excel exports. */
export async function getReportTransactions(
  workspaceId: string,
  period: ResolvedPeriod
): Promise<ReportTransaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { workspaceId, date: { gte: period.from, lte: period.to } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      type: true,
      description: true,
      counterparty: true,
      amount: true,
      category: { select: { name: true } },
    },
    take: 20_000,
  });

  return rows.map((row) => ({
    date: isoDay(row.date),
    type: row.type,
    description: row.description,
    counterparty: row.counterparty,
    category: row.category?.name ?? "Uncategorized",
    amount: Number(row.amount),
  }));
}
