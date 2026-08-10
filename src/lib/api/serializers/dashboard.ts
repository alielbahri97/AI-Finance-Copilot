/**
 * Wire shaping for `GET /api/dashboard`.
 *
 * `DashboardData` is the web page's view model: every amount in it is a
 * JavaScript number, because the page hands them straight to `formatCurrency`.
 * Nothing here recomputes anything — it only restates those numbers as decimal
 * strings and normalizes the dates, which is the whole of the difference
 * between the page's props and the native contract.
 *
 * The one shape change worth knowing about: `balanceHistory[].date` is a
 * `YYYY-MM-DD` day key on the page and is widened to a full UTC-midnight
 * timestamp here, so every date on the wire reads the same way.
 */

import { money, moneyOrNull, timestamp, timestampOrNull } from "@/lib/api/wire";
import type { MoneyString, TimestampString } from "@/lib/api/wire";
import type {
  BalancePoint,
  CategoryPoint,
  DashboardData,
  MonthlyPoint,
  TransactionSummary,
} from "@/lib/data";
import type { CashAccount, CashBank, CashPosition } from "@/lib/finance/cash";

export interface SerializedMonthlyPoint {
  /** Short month label, e.g. "Jan" — a chart axis tick, not a date. */
  month: string;
  income: MoneyString;
  expenses: MoneyString;
  net: MoneyString;
}

export interface SerializedCategoryPoint {
  category: string;
  color: string;
  amount: MoneyString;
}

export interface SerializedBalancePoint {
  date: TimestampString;
  balance: MoneyString;
}

export interface SerializedTransactionSummary {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: MoneyString;
  category: string | null;
  categoryColor: string | null;
  description: string;
  date: TimestampString;
}

export interface SerializedCashAccount {
  id: string;
  connectionId: string;
  connectionLabel: string;
  label: string;
  currency: string | null;
  balance: MoneyString | null;
  balanceAt: TimestampString | null;
  includeInTotals: boolean;
  counted: boolean;
  reason: CashAccount["reason"];
}

export interface SerializedCashBank {
  connectionId: string;
  label: string;
  total: MoneyString;
  accounts: SerializedCashAccount[];
}

export interface SerializedCashPosition {
  source: CashPosition["source"];
  total: MoneyString;
  currency: string;
  banks: SerializedCashBank[];
  accounts: SerializedCashAccount[];
  countedAccounts: number;
  excludedAccounts: number;
  hasOtherCurrency: boolean;
  asOf: TimestampString | null;
  transactionBalance: MoneyString;
}

export interface SerializedDashboard {
  monthIncome: MoneyString;
  monthExpenses: MoneyString;
  /** Percent change vs the previous month; null when there is no baseline. */
  incomeChangePct: number | null;
  expensesChangePct: number | null;
  totalBalance: MoneyString;
  cash: SerializedCashPosition;
  /** Whole percent of this month's income kept. */
  savingsRate: number;
  monthlySeries: SerializedMonthlyPoint[];
  categoryBreakdown: SerializedCategoryPoint[];
  largestExpenses: SerializedTransactionSummary[];
  balanceHistory: SerializedBalancePoint[];
  recentTransactions: SerializedTransactionSummary[];
  transactionCount: number;
}

function serializeSummary(entry: TransactionSummary): SerializedTransactionSummary {
  return {
    id: entry.id,
    type: entry.type,
    amount: money(entry.amount),
    category: entry.category,
    categoryColor: entry.categoryColor,
    description: entry.description,
    date: timestamp(entry.date),
  };
}

function serializeMonthlyPoint(point: MonthlyPoint): SerializedMonthlyPoint {
  return {
    month: point.month,
    income: money(point.income),
    expenses: money(point.expenses),
    net: money(point.net),
  };
}

function serializeCategoryPoint(point: CategoryPoint): SerializedCategoryPoint {
  return { category: point.category, color: point.color, amount: money(point.amount) };
}

function serializeBalancePoint(point: BalancePoint): SerializedBalancePoint {
  return { date: timestamp(point.date), balance: money(point.balance) };
}

function serializeCashAccount(account: CashAccount): SerializedCashAccount {
  return {
    id: account.id,
    connectionId: account.connectionId,
    connectionLabel: account.connectionLabel,
    label: account.label,
    currency: account.currency,
    balance: moneyOrNull(account.balance),
    balanceAt: timestampOrNull(account.balanceAt),
    includeInTotals: account.includeInTotals,
    counted: account.counted,
    reason: account.reason,
  };
}

function serializeCashBank(bank: CashBank): SerializedCashBank {
  return {
    connectionId: bank.connectionId,
    label: bank.label,
    total: money(bank.total),
    accounts: bank.accounts.map(serializeCashAccount),
  };
}

export function serializeCashPosition(cash: CashPosition): SerializedCashPosition {
  return {
    source: cash.source,
    total: money(cash.total),
    currency: cash.currency,
    banks: cash.banks.map(serializeCashBank),
    accounts: cash.accounts.map(serializeCashAccount),
    countedAccounts: cash.countedAccounts,
    excludedAccounts: cash.excludedAccounts,
    hasOtherCurrency: cash.hasOtherCurrency,
    asOf: timestampOrNull(cash.asOf),
    transactionBalance: money(cash.transactionBalance),
  };
}

export function serializeDashboard(data: DashboardData): SerializedDashboard {
  return {
    monthIncome: money(data.monthIncome),
    monthExpenses: money(data.monthExpenses),
    incomeChangePct: data.incomeChangePct,
    expensesChangePct: data.expensesChangePct,
    totalBalance: money(data.totalBalance),
    cash: serializeCashPosition(data.cash),
    savingsRate: data.savingsRate,
    monthlySeries: data.monthlySeries.map(serializeMonthlyPoint),
    categoryBreakdown: data.categoryBreakdown.map(serializeCategoryPoint),
    largestExpenses: data.largestExpenses.map(serializeSummary),
    balanceHistory: data.balanceHistory.map(serializeBalancePoint),
    recentTransactions: data.recentTransactions.map(serializeSummary),
    transactionCount: data.transactionCount,
  };
}
