import "server-only";
import { cache } from "react";

import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { trackEvent } from "@/lib/analytics";
import { attributeReferral } from "@/lib/billing/referrals";
import { ensureDefaultCategories } from "@/lib/categories";
import { currencyFromRequestHeaders } from "@/lib/currency/location";
import { anchorBalanceHistory, type CashPosition } from "@/lib/finance/cash";
import { loadCashPosition } from "@/lib/finance/cash-data";
import { prisma } from "@/lib/prisma";
import { personalMembershipId, personalWorkspaceId } from "@/lib/workspace/ids";

/**
 * Ensures a Profile row, the personal workspace and the default category set
 * exist for the authenticated Supabase user. Called from the dashboard layout
 * so every signed-in user has one. First creation also records the signup
 * event and attributes the referral code from the signup metadata, if any.
 */
/** Seeds defaults without failing the dashboard layout on transient DB errors. */
async function seedDefaultsSafely(workspaceId: string, userId: string) {
  try {
    await ensureDefaultCategories(workspaceId, userId);
  } catch (error) {
    console.error("[getOrCreateProfile] default category seed failed", { userId, error });
  }
}

/**
 * Creates the user's personal workspace (deterministic id "ws-<userId>")
 * with them as OWNER. Idempotent: existing rows are left untouched.
 */
async function ensurePersonalWorkspace(userId: string, name: string, currency: string) {
  const workspaceId = personalWorkspaceId(userId);
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: {},
    create: { id: workspaceId, name, currency },
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: {},
    create: { id: personalMembershipId(userId), workspaceId, userId, role: "OWNER" },
  });
  return workspaceId;
}

/**
 * The DEFAULT_CATEGORY_RULES backfill only matters when a deploy ships new
 * patterns, so running it once per user per warm isolate is enough — fresh
 * isolates after a deploy re-run it. Without this memo every page view paid
 * three extra queries including a 27-row INSERT.
 */
const seededThisIsolate = new Set<string>();

async function backfillDefaultsOncePerIsolate(userId: string) {
  if (seededThisIsolate.has(userId)) return;
  seededThisIsolate.add(userId);
  await seedDefaultsSafely(personalWorkspaceId(userId), userId);
}

export const getOrCreateProfile = cache(async (user: User) => {
  const existing = await prisma.profile.findUnique({ where: { id: user.id } });
  if (existing) {
    // Backfill any DEFAULT_CATEGORY_RULES patterns added after the account was seeded.
    await backfillDefaultsOncePerIsolate(existing.id);
    return existing;
  }

  const headerList = await headers();
  const currency = currencyFromRequestHeaders(headerList);

  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email: user.email ?? `${user.id}@unknown.local`,
      fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
      avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      currency,
      // Prefer free Groq for new accounts (OpenAI requires billing).
      aiProvider: "GROQ",
    },
  });

  const workspaceName =
    profile.fullName?.trim() || profile.email.split("@")[0] || "My workspace";
  const workspaceId = await ensurePersonalWorkspace(user.id, workspaceName, currency);
  await seedDefaultsSafely(workspaceId, user.id);

  await trackEvent(user.id, "signup");
  const referralCode = user.user_metadata?.referral_code as string | undefined;
  if (referralCode) {
    await attributeReferral(user.id, referralCode);
  }

  return profile;
});

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
  /** Aggregated bank cash with its per-account breakdown. */
  cash: CashPosition;
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

/**
 * Aggregates the last six months of transactions for the dashboard.
 * cache()-wrapped so the streamed stats and charts sections of the dashboard
 * page share one query set per request.
 */
export const getDashboardData = cache(async (workspaceId: string): Promise<DashboardData> => {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [transactions, priorNet] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: since } },
      orderBy: { date: "desc" },
      include: { category: { select: { name: true, color: true } } },
    }),
    prisma.transaction
      .findMany({
        where: { workspaceId, date: { lt: since } },
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
  const transactionBalance = Math.round((priorNet + windowNet) * 100) / 100;

  // Cash comes from the connected banks when there are any; the balance chart
  // is anchored to the same figure so the two never disagree.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { currency: true },
  });
  const cash = await loadCashPosition(
    workspaceId,
    workspace?.currency ?? "USD",
    transactionBalance
  );

  return {
    monthIncome,
    monthExpenses,
    incomeChangePct: percentChange(monthIncome, prevMonthIncome),
    expensesChangePct: percentChange(monthExpenses, prevMonthExpenses),
    totalBalance: cash.total,
    cash,
    savingsRate: monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0,
    monthlySeries: Array.from(monthly.values()),
    categoryBreakdown: Array.from(categories.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
    largestExpenses,
    balanceHistory: anchorBalanceHistory(
      balanceHistory,
      cash.source === "bank" ? cash.total : null
    ),
    recentTransactions: transactions.slice(0, 8).map(toSummary),
    transactionCount: transactions.length,
  };
});
