import "server-only";
import type { User } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

/**
 * Ensures a Profile row exists for the authenticated Supabase user.
 * Called from the dashboard layout so every signed-in user has one.
 */
export async function getOrCreateProfile(user: User) {
  return prisma.profile.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email: user.email ?? `${user.id}@unknown.local`,
      fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
      avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
  });
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface CategoryPoint {
  category: string;
  amount: number;
}

export interface DashboardData {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  savingsRate: number;
  monthlySeries: MonthlyPoint[];
  categoryBreakdown: CategoryPoint[];
  recentTransactions: {
    id: string;
    type: "INCOME" | "EXPENSE";
    amount: number;
    category: string;
    description: string;
    date: string;
  }[];
  transactionCount: number;
}

/** Aggregates the last six months of transactions for the dashboard. */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const since = new Date();
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "desc" },
  });

  let totalIncome = 0;
  let totalExpenses = 0;
  const monthly = new Map<string, MonthlyPoint>();
  const categories = new Map<string, number>();

  // Pre-fill the last six months so the chart always has a full axis.
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthly.set(key, {
      month: d.toLocaleString("en-US", { month: "short" }),
      income: 0,
      expenses: 0,
    });
  }

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const key = `${tx.date.getFullYear()}-${tx.date.getMonth()}`;
    const point = monthly.get(key);
    if (tx.type === "INCOME") {
      totalIncome += amount;
      if (point) point.income += amount;
    } else {
      totalExpenses += amount;
      if (point) point.expenses += amount;
      categories.set(tx.category, (categories.get(tx.category) ?? 0) + amount);
    }
  }

  const balance = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.round((balance / totalIncome) * 100) : 0;

  return {
    totalIncome,
    totalExpenses,
    balance,
    savingsRate,
    monthlySeries: Array.from(monthly.values()),
    categoryBreakdown: Array.from(categories.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6),
    recentTransactions: transactions.slice(0, 8).map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: Number(tx.amount),
      category: tx.category,
      description: tx.description,
      date: tx.date.toISOString(),
    })),
    transactionCount: transactions.length,
  };
}

/** Compact plain-text summary of the user's finances for the AI system prompt. */
export async function getFinancialContext(userId: string): Promise<string> {
  const data = await getDashboardData(userId);
  const lines = [
    `Last 6 months summary:`,
    `- Total income: ${data.totalIncome.toFixed(2)}`,
    `- Total expenses: ${data.totalExpenses.toFixed(2)}`,
    `- Net balance: ${data.balance.toFixed(2)}`,
    `- Savings rate: ${data.savingsRate}%`,
    `- Top expense categories: ${
      data.categoryBreakdown.map((c) => `${c.category} (${c.amount.toFixed(2)})`).join(", ") ||
      "none recorded"
    }`,
    `- Recent transactions:`,
    ...data.recentTransactions.map(
      (tx) =>
        `  * ${tx.date.slice(0, 10)} ${tx.type === "INCOME" ? "+" : "-"}${tx.amount.toFixed(2)} ${tx.category}: ${tx.description}`
    ),
  ];
  return lines.join("\n");
}
