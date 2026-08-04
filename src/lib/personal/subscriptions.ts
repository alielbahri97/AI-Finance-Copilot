/**
 * Subscription insights for the Personal edition — pure logic, no database,
 * no Prisma types.
 *
 * Nothing here re-implements recurrence detection: `detectRecurring` already
 * decides what is a repeating charge and at what cadence, and this module adds
 * only what a person (rather than a business) needs on top of it —
 *
 *   * whether the charge is a subscription they could cancel or a bill they
 *     could not (rent is recurring, but telling someone to review their rent
 *     is not advice),
 *   * whether the price moved between the first and the most recent charge,
 *   * whether the charge has quietly stopped, so it does not inflate the
 *     monthly total of things they are still paying for,
 *   * what is due in the next month.
 *
 * On what the data can and cannot say: bank transactions show that money left
 * an account, never whether the thing it paid for was used. Every flag below
 * is a prompt to look, not a conclusion.
 */

import {
  detectRecurring,
  nextOccurrences,
  normalizeMerchant,
  type Cadence,
  type FinanceTransaction,
  type RecurringItem,
} from "@/lib/finance/recurrence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_PER_YEAR = 12;

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
 * How far past its expected date a charge may be before the subscription is
 * treated as stopped. Payment dates drift by a few days (weekends, month
 * lengths, retries), so one interval is too tight; half an interval of slack
 * on top of it is late enough to mean something.
 */
export const OVERDUE_INTERVAL_MULTIPLIER = 1.5;

/**
 * Minimum number of charges before a subscription is worth a second look.
 * Six charges is roughly half a year at monthly cadence: long enough that the
 * initial decision to sign up is no longer fresh.
 */
export const REVIEW_MIN_CHARGES = 6;

/**
 * Monthly-equivalent ceiling for the same check. Above this a charge is
 * visible on any statement and does not need pointing out; at or below it,
 * the cost is small enough per month to keep being paid without notice while
 * still adding up to a meaningful amount over a year.
 */
export const REVIEW_MAX_MONTHLY_AMOUNT = 15;

/**
 * How far ahead upcoming charges are projected. One month matches how people
 * think about subscriptions, and beyond it the projected dates drift enough
 * that a precise day would be overstating what the cadence supports.
 */
export const UPCOMING_HORIZON_DAYS = 30;

/**
 * Category names that mean "recurring commitment", not "subscription".
 *
 * `Housing` and `Utilities` are the app's own defaults (see
 * `DEFAULT_CATEGORIES`); the rest are the names people commonly add for the
 * same kind of spend. Matching is case-insensitive on the trimmed name, and
 * anything unrecognised is treated as a subscription, so a workspace with its
 * own category names still gets a usable page.
 */
export const BILL_CATEGORY_NAMES: readonly string[] = [
  "housing",
  "rent",
  "mortgage",
  "utilities",
  "insurance",
  "loan",
  "loans",
  "loan repayment",
  "loan repayments",
  "debt repayment",
  "debt repayments",
];

/** A cancellable subscription, or a recurring commitment that is not one. */
export type SubscriptionKind = "subscription" | "bill";

/**
 * `price_increase` — the latest charge is materially higher than the first.
 * `overdue` — nothing has been charged for well past the usual interval.
 * `unused_looking` — matches the profile of a subscription people forget:
 *   long-running, unchanged price, small monthly cost. It means "worth
 *   reviewing"; transaction data cannot show whether anything was used.
 */
export type SubscriptionFlag = "price_increase" | "unused_looking" | "overdue";

export interface SubscriptionPriceChange {
  /** Amount of the earliest charge in the window. */
  from: number;
  /** Amount of the most recent charge. */
  to: number;
  /** Signed change as a percentage of `from`. */
  percent: number;
}

export interface DetectedSubscription {
  /** Matches the `RecurringItem` key: `${type}:${normalizedMerchant}`. */
  key: string;
  label: string;
  category: string;
  kind: SubscriptionKind;
  cadence: Cadence;
  intervalDays: number;
  timesSeen: number;
  monthsSeen: number;
  /** Mean charge amount across the window. */
  averageAmount: number;
  /** `averageAmount` normalised to a monthly equivalent. */
  monthlyAmount: number;
  /** ISO yyyy-mm-dd of the most recent charge. */
  lastChargedAt: string;
  /** ISO yyyy-mm-dd of the next projected charge. */
  nextChargeAt: string;
  priceChange: SubscriptionPriceChange | null;
  flags: SubscriptionFlag[];
}

export interface UpcomingCharge {
  key: string;
  label: string;
  amount: number;
  /** ISO yyyy-mm-dd. */
  date: string;
  kind: SubscriptionKind;
}

export interface SubscriptionAnalysis {
  subscriptions: DetectedSubscription[];
  bills: DetectedSubscription[];
  /** Monthly equivalent of active subscriptions; overdue ones are left out. */
  totalMonthlyCost: number;
  /** The same for recurring bills, kept separate so the two never blur. */
  totalMonthlyBills: number;
  upcomingCharges: UpcomingCharge[];
  /** Subscriptions carrying at least one flag. Bills are not counted. */
  flaggedCount: number;
  /** `totalMonthlyCost` over a year — the figure that changes behaviour. */
  annualisedCost: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The merchant key `detectRecurring` groups by, recomputed for joining. */
function recurringKeyOf(transaction: FinanceTransaction): string {
  return `${transaction.type}:${normalizeMerchant(transaction.counterparty?.trim() || transaction.description)}`;
}

/**
 * Whether a category name means a commitment rather than a subscription.
 * Unrecognised names degrade to `subscription`, which is the safer default:
 * it lands the item on a list the user is invited to review, and reviewing
 * something uncancellable costs them only a glance.
 */
export function classifySubscriptionKind(category: string): SubscriptionKind {
  return BILL_CATEGORY_NAMES.includes(category.trim().toLowerCase()) ? "bill" : "subscription";
}

/**
 * Compares the earliest and most recent charge of one merchant. Returns null
 * unless the move clears both thresholds, so noise never raises a flag.
 */
export function detectPriceChange(
  amountsOldestFirst: readonly number[]
): SubscriptionPriceChange | null {
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

function isOverdue(item: RecurringItem, now: Date): boolean {
  return daysSince(item.lastDate, now) > item.intervalDays * OVERDUE_INTERVAL_MULTIPLIER;
}

function subscriptionFlags(
  item: RecurringItem,
  priceChange: SubscriptionPriceChange | null,
  overdue: boolean
): SubscriptionFlag[] {
  const flags: SubscriptionFlag[] = [];
  if (priceChange !== null && priceChange.to > priceChange.from) flags.push("price_increase");
  if (overdue) flags.push("overdue");
  // A stopped charge is not worth reviewing — it has already stopped.
  if (
    !overdue &&
    priceChange === null &&
    item.timesSeen >= REVIEW_MIN_CHARGES &&
    item.monthlyAmount <= REVIEW_MAX_MONTHLY_AMOUNT
  ) {
    flags.push("unused_looking");
  }
  return flags;
}

/**
 * The next projected charge date. Built with `nextOccurrences` so an overdue
 * item rolls forward the same way it does on the forecast, rather than
 * reporting a date in the past.
 */
function nextChargeDate(item: RecurringItem, from: Date): Date {
  const windowEnd = new Date(from.getTime() + (item.intervalDays * 2 + 1) * MS_PER_DAY);
  const [next] = nextOccurrences(item, from, windowEnd);
  return next ?? windowEnd;
}

/**
 * Turns raw transactions into the subscription picture: what repeats, what it
 * costs per month, what changed price, what looks abandoned and what is due
 * next. `now` is injected so the result is deterministic and testable.
 */
export function analyzeSubscriptions(
  transactions: FinanceTransaction[],
  now: Date
): SubscriptionAnalysis {
  const today = utcDay(now);

  // Amount history per merchant, oldest first, for the price comparison.
  const amountsByKey = new Map<string, { amount: number; time: number }[]>();
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    const key = recurringKeyOf(transaction);
    const history = amountsByKey.get(key) ?? [];
    history.push({ amount: transaction.amount, time: transaction.date.getTime() });
    amountsByKey.set(key, history);
  }

  const detected: DetectedSubscription[] = [];
  const activeItems: { item: RecurringItem; kind: SubscriptionKind }[] = [];

  for (const item of detectRecurring(transactions)) {
    if (item.type !== "EXPENSE") continue;

    const history = [...(amountsByKey.get(item.key) ?? [])].sort((a, b) => a.time - b.time);
    const priceChange = detectPriceChange(history.map((entry) => entry.amount));
    const overdue = isOverdue(item, now);
    const kind = classifySubscriptionKind(item.category);

    detected.push({
      key: item.key,
      label: item.label,
      category: item.category,
      kind,
      cadence: item.cadence,
      intervalDays: item.intervalDays,
      timesSeen: item.timesSeen,
      monthsSeen: item.monthsSeen,
      averageAmount: item.averageAmount,
      monthlyAmount: item.monthlyAmount,
      lastChargedAt: item.lastDate,
      nextChargeAt: isoDay(nextChargeDate(item, today)),
      priceChange,
      flags: subscriptionFlags(item, priceChange, overdue),
    });

    // Overdue items are excluded from the totals and the schedule: projecting
    // charges for something that has stopped billing invents future spend.
    if (!overdue) activeItems.push({ item, kind });
  }

  const subscriptions = detected.filter((entry) => entry.kind === "subscription");
  const bills = detected.filter((entry) => entry.kind === "bill");

  const monthlyTotal = (kind: SubscriptionKind): number =>
    round2(
      activeItems
        .filter((entry) => entry.kind === kind)
        .reduce((sum, entry) => sum + entry.item.monthlyAmount, 0)
    );
  const totalMonthlyCost = monthlyTotal("subscription");

  const horizonEnd = new Date(today.getTime() + UPCOMING_HORIZON_DAYS * MS_PER_DAY);
  const upcomingCharges: UpcomingCharge[] = [];
  for (const { item, kind } of activeItems) {
    for (const occurrence of nextOccurrences(item, today, horizonEnd)) {
      upcomingCharges.push({
        key: item.key,
        label: item.label,
        amount: item.averageAmount,
        date: isoDay(occurrence),
        kind,
      });
    }
  }
  upcomingCharges.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));

  return {
    subscriptions,
    bills,
    totalMonthlyCost,
    totalMonthlyBills: monthlyTotal("bill"),
    upcomingCharges,
    flaggedCount: subscriptions.filter((entry) => entry.flags.length > 0).length,
    annualisedCost: round2(totalMonthlyCost * MONTHS_PER_YEAR),
  };
}
