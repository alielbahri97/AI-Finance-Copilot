/**
 * Aggregated cash: one figure across every bank account the workspace has
 * connected, with the per-account breakdown kept alongside it.
 *
 * Rules, all deliberate:
 *  - Accounts excluded with `includeInTotals` (a personal account, say) are
 *    reported but never summed.
 *  - Accounts whose currency differs from the workspace currency are not
 *    summed either. There is no FX rate anywhere in this app, and inventing
 *    one would silently misstate cash; they are flagged instead.
 *  - A workspace with no usable bank balance — CSV-only users, a bank that
 *    never returned a balance, a first sync that has not run yet — falls back
 *    to the transaction-derived running balance, exactly as before.
 *
 * Pure: the loader lives in ./cash-data.ts.
 */

export interface CashAccountInput {
  id: string;
  connectionId: string;
  /** Bank/organisation label for grouping, e.g. "ING". */
  connectionLabel: string;
  /** Masked account label, e.g. "…1234". */
  label: string;
  currency: string | null;
  balance: number | null;
  balanceAt: string | null;
  includeInTotals: boolean;
}

export interface CashAccount extends CashAccountInput {
  /** In the total: included, has a balance, and matches the workspace currency. */
  counted: boolean;
  /** Why it is not counted, for the UI to explain itself. */
  reason: "counted" | "excluded" | "no-balance" | "other-currency";
}

export interface CashBank {
  connectionId: string;
  label: string;
  /** Sum of this bank's counted accounts. */
  total: number;
  accounts: CashAccount[];
}

export interface CashPosition {
  /** Where the headline figure comes from. */
  source: "bank" | "transactions";
  total: number;
  currency: string;
  banks: CashBank[];
  accounts: CashAccount[];
  countedAccounts: number;
  excludedAccounts: number;
  /** True when at least one account is held in another currency. */
  hasOtherCurrency: boolean;
  /** Oldest balance timestamp among counted accounts — how stale the total is. */
  asOf: string | null;
  /** The transaction-derived balance, kept for comparison and fallback. */
  transactionBalance: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function classify(account: CashAccountInput, currency: string): CashAccount["reason"] {
  if (!account.includeInTotals) return "excluded";
  if (account.balance === null) return "no-balance";
  if (account.currency && account.currency.toUpperCase() !== currency.toUpperCase()) {
    return "other-currency";
  }
  return "counted";
}

export interface CashPositionInput {
  accounts: CashAccountInput[];
  /** Cumulative net of every recorded transaction. */
  transactionBalance: number;
  /** The workspace currency; only accounts held in it are summed. */
  currency: string;
}

export function computeCashPosition(input: CashPositionInput): CashPosition {
  const { transactionBalance, currency } = input;

  const accounts: CashAccount[] = input.accounts.map((account) => {
    const reason = classify(account, currency);
    return { ...account, reason, counted: reason === "counted" };
  });

  const counted = accounts.filter((account) => account.counted);
  const bankTotal = round2(counted.reduce((sum, account) => sum + (account.balance ?? 0), 0));

  const timestamps = counted
    .map((account) => account.balanceAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  const banks = new Map<string, CashBank>();
  for (const account of accounts) {
    const bank = banks.get(account.connectionId) ?? {
      connectionId: account.connectionId,
      label: account.connectionLabel,
      total: 0,
      accounts: [],
    };
    bank.accounts.push(account);
    if (account.counted) bank.total = round2(bank.total + (account.balance ?? 0));
    banks.set(account.connectionId, bank);
  }

  return {
    source: counted.length > 0 ? "bank" : "transactions",
    total: counted.length > 0 ? bankTotal : round2(transactionBalance),
    currency,
    banks: [...banks.values()].sort((a, b) => b.total - a.total),
    accounts,
    countedAccounts: counted.length,
    excludedAccounts: accounts.filter((account) => account.reason === "excluded").length,
    hasOtherCurrency: accounts.some((account) => account.reason === "other-currency"),
    asOf: timestamps[0] ?? null,
    transactionBalance: round2(transactionBalance),
  };
}

/**
 * Shifts a transaction-derived balance series so its last point equals the
 * aggregated bank total. The shape of the history is real — it is the day-by-day
 * net of imported transactions — but its level is only as complete as the
 * imports; the banks' own balances are the authority on where cash stands
 * today. Anchoring keeps the chart consistent with the cash card instead of
 * telling two different stories.
 */
export function anchorBalanceHistory<T extends { balance: number }>(
  history: T[],
  anchorTo: number | null
): T[] {
  if (anchorTo === null || history.length === 0) return history;
  const last = history[history.length - 1].balance;
  const delta = anchorTo - last;
  if (Math.abs(delta) < 0.005) return history;
  return history.map((point) => ({ ...point, balance: round2(point.balance + delta) }));
}

/**
 * The cash figure for a report period. Bank balances describe today, so they
 * only replace the transaction-derived close when the period actually runs up
 * to now; historical periods keep their own close.
 */
export function resolveReportCash(input: {
  transactionCash: number;
  bankCash: number | null;
  periodEnd: Date;
  now: Date;
}): { cash: number; source: "bank" | "transactions" } {
  const endsInThePast =
    input.periodEnd.getTime() < Date.UTC(
      input.now.getUTCFullYear(),
      input.now.getUTCMonth(),
      input.now.getUTCDate()
    );
  if (input.bankCash === null || endsInThePast) {
    return { cash: round2(input.transactionCash), source: "transactions" };
  }
  return { cash: round2(input.bankCash), source: "bank" };
}
