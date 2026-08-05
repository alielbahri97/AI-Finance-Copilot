/**
 * The edition-agnostic half of recurring-charge analysis: for every repeating
 * charge `detectRecurring` finds, what it costs per month, whether the price
 * moved, whether it has quietly stopped, and when it is due next.
 *
 * This started life inside `@/lib/personal/subscriptions` and was lifted out
 * unchanged when the Business edition needed the same three answers under
 * different framing — a person asks "what am I still paying for?", a company
 * asks "what does this vendor cost us a year?". Neither question changes how
 * the charge is measured, so both read this file and each keeps only its own
 * judgements (what counts as a bill, what counts as a duplicate tool).
 *
 * Nothing here re-implements detection: `detectRecurring` already decides what
 * repeats and at what cadence, and every amount below is derived from what it
 * returns.
 */

import {
  DAYS_PER_MONTH,
  detectRecurring,
  nextOccurrences,
  normalizeMerchant,
  type Cadence,
  type FinanceTransaction,
  type RecurringItem,
} from "./recurrence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MONTHS_PER_YEAR = 12;

/**
 * How much history a recurring-charge page loads: a year plus a small margin,
 * so a monthly charge that lands early in one month and late in the next still
 * contributes twelve samples to the price comparison. Matches the lookback the
 * forecast uses (`buildForecast`).
 */
export const RECURRING_LOOKBACK_DAYS = 370;

/**
 * Smallest relative price move worth reporting. Below this, a change is
 * usually a rounding difference, a card-scheme FX rate or a partial-month
 * proration rather than the merchant putting the price up.
 */
export const PRICE_CHANGE_MIN_PERCENT = 5;

/**
 * Smallest absolute price move worth reporting, in workspace currency. A
 * cheap subscription clears the 5% test on a few cents; both thresholds must
 * be met so a 0.20 drift on a 3.00 charge stays quiet.
 */
export const PRICE_CHANGE_MIN_AMOUNT = 0.5;

/**
 * How far past its expected date a charge may be before it is treated as
 * stopped. Payment dates drift by a few days (weekends, month lengths,
 * retries), so one interval is too tight; half an interval of slack on top of
 * it is late enough to mean something.
 */
export const OVERDUE_INTERVAL_MULTIPLIER = 1.5;

export interface PriceChange {
  /** Amount of the earliest charge in the window. */
  from: number;
  /** Amount of the most recent charge. */
  to: number;
  /** Signed change as a percentage of `from`. */
  percent: number;
}

/**
 * One repeating charge, measured. Every field is derived from transactions —
 * nothing here is a judgement about whether the charge is worth keeping.
 */
export interface RecurringCharge {
  /** Matches the `RecurringItem` key: `${type}:${normalizedMerchant}`. */
  key: string;
  label: string;
  category: string;
  cadence: Cadence;
  intervalDays: number;
  timesSeen: number;
  monthsSeen: number;
  /** Mean charge amount across the window. */
  averageAmount: number;
  /**
   * `averageAmount` normalised to a monthly equivalent by `detectRecurring`,
   * so a quarterly charge is already a third of its invoice. Every derived
   * figure — annual cost, share of spend, totals — starts here rather than
   * from the invoice amount, which is what keeps a non-monthly cadence from
   * being counted twelve times a year.
   */
  monthlyAmount: number;
  /** ISO yyyy-mm-dd of the most recent charge. */
  lastChargedAt: string;
  /** ISO yyyy-mm-dd of the next projected charge. */
  nextChargeAt: string;
  priceChange: PriceChange | null;
  /** Nothing charged for well past the usual interval: probably cancelled. */
  overdue: boolean;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC on the day of `date`, so day arithmetic is whole days. */
export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The merchant key `detectRecurring` groups by, recomputed for joining. */
function recurringKeyOf(transaction: FinanceTransaction): string {
  return `${transaction.type}:${normalizeMerchant(transaction.counterparty?.trim() || transaction.description)}`;
}

/**
 * Compares the earliest and most recent charge of one merchant. Returns null
 * unless the move clears both thresholds, so noise never raises a flag.
 */
export function detectPriceChange(amountsOldestFirst: readonly number[]): PriceChange | null {
  if (amountsOldestFirst.length < 2) return null;

  const from = amountsOldestFirst[0];
  const to = amountsOldestFirst[amountsOldestFirst.length - 1];
  if (from <= 0) return null;

  const delta = to - from;
  const percent = (delta / from) * 100;
  if (Math.abs(delta) < PRICE_CHANGE_MIN_AMOUNT) return null;
  if (Math.abs(percent) < PRICE_CHANGE_MIN_PERCENT) return null;

  return { from: round2(from), to: round2(to), percent: round2(percent) };
}

/** Days since the last charge, measured in whole UTC days. */
function daysSince(lastDate: string, now: Date): number {
  const last = new Date(`${lastDate}T00:00:00.000Z`).getTime();
  return (utcDay(now).getTime() - last) / MS_PER_DAY;
}

/**
 * The next projected charge date. Built with `nextOccurrences` so an overdue
 * item rolls forward the same way it does on the forecast, rather than
 * reporting a date in the past.
 */
function nextChargeDate(item: Pick<RecurringItem, "lastDate" | "intervalDays">, from: Date): Date {
  const windowEnd = new Date(from.getTime() + (item.intervalDays * 2 + 1) * MS_PER_DAY);
  const [next] = nextOccurrences(item, from, windowEnd);
  return next ?? windowEnd;
}

/**
 * Projects a charge's occurrences within [from, to] — the same scheduling the
 * forecast uses, so an upcoming-charges list and the cash forecast never
 * disagree about when something is due.
 */
export function chargeOccurrences(charge: RecurringCharge, from: Date, to: Date): Date[] {
  return nextOccurrences(
    { lastDate: charge.lastChargedAt, intervalDays: charge.intervalDays },
    from,
    to
  );
}

/** Expense amount history per merchant key, oldest first. */
function expenseAmountHistory(transactions: FinanceTransaction[]): Map<string, number[]> {
  const byKey = new Map<string, { amount: number; time: number }[]>();
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    const key = recurringKeyOf(transaction);
    const history = byKey.get(key) ?? [];
    history.push({ amount: transaction.amount, time: transaction.date.getTime() });
    byKey.set(key, history);
  }

  return new Map(
    [...byKey].map(([key, history]) => [
      key,
      [...history].sort((a, b) => a.time - b.time).map((entry) => entry.amount),
    ])
  );
}

/**
 * Measures already-detected recurring items, so a caller that needs the raw
 * items too (the copilot snapshot) pays for detection once.
 *
 * Income is dropped: a salary or a client payment repeats as reliably as any
 * subscription, but neither edition's recurring-spend surface is about money
 * coming in, and both would otherwise report a salary as their largest
 * "charge". `now` is injected so the result is deterministic and testable.
 */
export function summarizeDetectedCharges(
  items: RecurringItem[],
  transactions: FinanceTransaction[],
  now: Date
): RecurringCharge[] {
  const today = utcDay(now);
  const amountsByKey = expenseAmountHistory(transactions);
  const charges: RecurringCharge[] = [];

  for (const item of items) {
    if (item.type !== "EXPENSE") continue;

    charges.push({
      key: item.key,
      label: item.label,
      category: item.category,
      cadence: item.cadence,
      intervalDays: item.intervalDays,
      timesSeen: item.timesSeen,
      monthsSeen: item.monthsSeen,
      averageAmount: item.averageAmount,
      monthlyAmount: item.monthlyAmount,
      lastChargedAt: item.lastDate,
      nextChargeAt: isoDay(nextChargeDate(item, today)),
      priceChange: detectPriceChange(amountsByKey.get(item.key) ?? []),
      overdue: daysSince(item.lastDate, now) > item.intervalDays * OVERDUE_INTERVAL_MULTIPLIER,
    });
  }

  return charges;
}

/** Detects and measures in one step, in `detectRecurring`'s order (dearest first). */
export function summarizeRecurringCharges(
  transactions: FinanceTransaction[],
  now: Date
): RecurringCharge[] {
  return summarizeDetectedCharges(detectRecurring(transactions), transactions, now);
}

/**
 * A charge's cost over a year. Cadence-safe by construction: it multiplies the
 * monthly equivalent, never the invoice, so a €600 annual licence billed once
 * costs €600 a year rather than €7,200 — and a quarterly charge that has just
 * been raised is reported as a price rise, not as eleven months of arrears.
 */
export function annualisedCost(monthlyAmount: number): number {
  return round2(monthlyAmount * MONTHS_PER_YEAR);
}

/**
 * Average monthly expenses across the history actually present, used as the
 * denominator for "share of spend". Measured over the observed span rather
 * than a fixed twelve months so a workspace three months into its first
 * import gets a share of what it has spent, not a share of an imagined year.
 */
export function monthlyExpenseBase(transactions: FinanceTransaction[], now: Date): number {
  let total = 0;
  let earliest: number | null = null;
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    total += transaction.amount;
    const time = transaction.date.getTime();
    if (earliest === null || time < earliest) earliest = time;
  }
  if (earliest === null || total <= 0) return 0;

  const spanDays = (utcDay(now).getTime() - utcDay(new Date(earliest)).getTime()) / MS_PER_DAY + 1;
  const months = Math.max(1, spanDays / DAYS_PER_MONTH);
  return round2(total / months);
}
