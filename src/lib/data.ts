import "server-only";
import type { User } from "@supabase/supabase-js";

import { ensureDefaultCategories } from "@/lib/categories";
import { prisma } from "@/lib/prisma";

/**
 * Ensures a Profile row (and the default category set) exists for the
 * authenticated Supabase user. Called from the dashboard layout so every
 * signed-in user has one.
 */
export async function getOrCreateProfile(user: User) {
  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email: user.email ?? `${user.id}@unknown.local`,
      fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
      avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
  });
  await ensureDefaultCategories(user.id);
  return profile;
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

export interface CategoryPoint {
  category: string;
  color: string;
  amount: number;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface TransactionSummary {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  category: string | null;
  categoryColor: string | null;
  description: string;
  date: string;
}

export interface DashboardData {
  /** Current calendar month. */
  monthIncome: number;
  monthExpenses: number;
  /** Percent change vs the previous month; null when there is no baseline. */
  incomeChangePct: number | null;
  expensesChangePct: number | null;
  /** All-time net across recorded transactions. */
  totalBalance: number;
  savingsRate: number;
  monthlySeries: MonthlyPoint[];
  categoryBreakdown: CategoryPoint[];
  largestExpenses: TransactionSummary[];
  balanceHistory: BalancePoint[];
  recentTransactions: TransactionSummary[];
  transactionCount: number;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Aggregates the last six months of transactions for the dashboard. */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [transactions, priorNet] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "desc" },
      include: { category: { select: { name: true, color: true } } },
    }),
    prisma.transaction
      .findMany({
        where: { userId, date: { lt: since } },
        select: { type: true, amount: true },
      })
      .then((rows) =>
        rows.reduce(
          (sum, row) => sum + (row.type === "INCOME" ? Number(row.amount) : -Number(row.amount)),
          0
        )
      ),
  ]);

  const currentKey = monthKey(now);
  const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousKey = monthKey(previousMonthDate);

  // Pre-fill the last six months so charts always have a full axis.
  const monthly = new Map<string, MonthlyPoint>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthly.set(monthKey(d), {
      month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      income: 0,
      expenses: 0,
      net: 0,
    });
  }

  const categories = new Map<string, CategoryPoint>();
  const daily = new Map<string, number>();
  let monthIncome = 0;
  let monthExpenses = 0;
  let prevMonthIncome = 0;
  let prevMonthExpenses = 0;
  let windowNet = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const signed = tx.type === "INCOME" ? amount : -amount;
    const key = monthKey(tx.date);
    const point = monthly.get(key);

    if (point) {
      if (tx.type === "INCOME") point.income += amount;
      else point.expenses += amount;
      point.net += signed;
    }

    if (key === currentKey) {
      if (tx.type === "INCOME") monthIncome += amount;
      else monthExpenses += amount;
    } else if (key === previousKey) {
      if (tx.type === "INCOME") prevMonthIncome += amount;
      else prevMonthExpenses += amount;
    }

    if (tx.type === "EXPENSE") {
      const name = tx.category?.name ?? "Uncategorized";
      const entry = categories.get(name) ?? {
        category: name,
        color: tx.category?.color ?? "#94a3b8",
        amount: 0,
      };
      entry.amount += amount;
      categories.set(name, entry);
    }

    const dayKey = tx.date.toISOString().slice(0, 10);
    daily.set(dayKey, (daily.get(dayKey) ?? 0) + signed);
    windowNet += signed;
  }

  // Cash balance history: cumulative net per day, seeded with everything
  // recorded before the window.
  const balanceHistory: BalancePoint[] = [];
  let running = priorNet;
  for (const [date, delta] of [...daily.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    running += delta;
    balanceHistory.push({ date, balance: Math.round(running * 100) / 100 });
  }

  const toSummary = (tx: (typeof transactions)[number]): TransactionSummary => ({
    id: tx.id,
    type: tx.type,
    amount: Number(tx.amount),
    category: tx.category?.name ?? null,
    categoryColor: tx.category?.color ?? null,
    description: tx.description,
    date: tx.date.toISOString(),
  });

  const largestExpenses = transactions
    .filter((tx) => tx.type === "EXPENSE")
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5)
    .map(toSummary);

  const monthNet = monthIncome - monthExpenses;

  return {
    monthIncome,
    monthExpenses,
    incomeChangePct: percentChange(monthIncome, prevMonthIncome),
    expensesChangePct: percentChange(monthExpenses, prevMonthExpenses),
    totalBalance: Math.round((priorNet + windowNet) * 100) / 100,
    savingsRate: monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0,
    monthlySeries: Array.from(monthly.values()),
    categoryBreakdown: Array.from(categories.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
    largestExpenses,
    balanceHistory,
    recentTransactions: transactions.slice(0, 8).map(toSummary),
    transactionCount: transactions.length,
  };
}

/** Compact plain-text summary of the user's finances for the AI system prompt. */
export async function getFinancialContext(userId: string): Promise<string> {
  const data = await getDashboardData(userId);
  const lines = [
    `Current month: income ${data.monthIncome.toFixed(2)}, expenses ${data.monthExpenses.toFixed(2)}, savings rate ${data.savingsRate}%`,
    `All-time net balance: ${data.totalBalance.toFixed(2)}`,
    `Top expense categories (last 6 months): ${
      data.categoryBreakdown.map((c) => `${c.category} (${c.amount.toFixed(2)})`).join(", ") ||
      "none recorded"
    }`,
    `Largest recent expenses: ${
      data.largestExpenses
        .map((tx) => `${tx.description} ${tx.amount.toFixed(2)} on ${tx.date.slice(0, 10)}`)
        .join("; ") || "none"
    }`,
    `Recent transactions:`,
    ...data.recentTransactions.map(
      (tx) =>
        `  * ${tx.date.slice(0, 10)} ${tx.type === "INCOME" ? "+" : "-"}${tx.amount.toFixed(2)} ${tx.category ?? "Uncategorized"}: ${tx.description}`
    ),
  ];
  return lines.join("\n");
}
