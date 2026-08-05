/**
 * Subscription insights for the Personal edition — pure logic, no database,
 * no Prisma types.
 *
 * Nothing here re-implements recurrence detection or measurement:
 * `detectRecurring` decides what is a repeating charge and at what cadence,
 * `@/lib/finance/recurring-spend` measures each one (monthly cost, price move,
 * whether it has stopped, when it is due next), and this module adds only what
 * a person (rather than a business) needs on top of that —
 *
 *   * whether the charge is a subscription they could cancel or a bill they
 *     could not (rent is recurring, but telling someone to review their rent
 *     is not advice),
 *   * whether the charge has quietly stopped, so it does not inflate the
 *     monthly total of things they are still paying for,
 *   * whether it looks like one they have forgotten about,
 *   * what is due in the next month.
 *
 * On what the data can and cannot say: bank transactions show that money left
 * an account, never whether the thing it paid for was used. Every flag below
 * is a prompt to look, not a conclusion.
 */

import type { FinanceTransaction } from "@/lib/finance/recurrence";
import {
  chargeOccurrences,
  MONTHS_PER_YEAR,
  round2,
  summarizeRecurringCharges,
  utcDay,
  type PriceChange,
  type RecurringCharge,
} from "@/lib/finance/recurring-spend";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The price-move and stopped-charge thresholds are shared with the Business
 * recurring-spend audit, and re-exported here so this module stays the one
 * import the personal subscriptions feature needs.
 */
export {
  OVERDUE_INTERVAL_MULTIPLIER,
  PRICE_CHANGE_MIN_AMOUNT,
  PRICE_CHANGE_MIN_PERCENT,
  detectPriceChange,
} from "@/lib/finance/recurring-spend";

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

/** The shared price comparison, under the name this feature has always used. */
export type SubscriptionPriceChange = PriceChange;

/**
 * A measured recurring charge plus the two personal judgements: what kind of
 * commitment it is, and what about it is worth the user's attention. `overdue`
 * is dropped because it is carried by the flags.
 */
export interface DetectedSubscription extends Omit<RecurringCharge, "overdue"> {
  kind: SubscriptionKind;
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

/**
 * Whether a category name means a commitment rather than a subscription.
 * Unrecognised names degrade to `subscription`, which is the safer default:
 * it lands the item on a list the user is invited to review, and reviewing
 * something uncancellable costs them only a glance.
 */
export function classifySubscriptionKind(category: string): SubscriptionKind {
  return BILL_CATEGORY_NAMES.includes(category.trim().toLowerCase()) ? "bill" : "subscription";
}

function subscriptionFlags(charge: RecurringCharge): SubscriptionFlag[] {
  const flags: SubscriptionFlag[] = [];
  const { priceChange, overdue } = charge;
  if (priceChange !== null && priceChange.to > priceChange.from) flags.push("price_increase");
  if (overdue) flags.push("overdue");
  // A stopped charge is not worth reviewing — it has already stopped.
  if (
    !overdue &&
    priceChange === null &&
    charge.timesSeen >= REVIEW_MIN_CHARGES &&
    charge.monthlyAmount <= REVIEW_MAX_MONTHLY_AMOUNT
  ) {
    flags.push("unused_looking");
  }
  return flags;
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

  const detected: DetectedSubscription[] = [];
  const activeCharges: { charge: RecurringCharge; kind: SubscriptionKind }[] = [];

  for (const charge of summarizeRecurringCharges(transactions, now)) {
    const kind = classifySubscriptionKind(charge.category);
    const { overdue, ...measured } = charge;

    detected.push({ ...measured, kind, flags: subscriptionFlags(charge) });

    // Overdue items are excluded from the totals and the schedule: projecting
    // charges for something that has stopped billing invents future spend.
    if (!overdue) activeCharges.push({ charge, kind });
  }

  const subscriptions = detected.filter((entry) => entry.kind === "subscription");
  const bills = detected.filter((entry) => entry.kind === "bill");

  const monthlyTotal = (kind: SubscriptionKind): number =>
    round2(
      activeCharges
        .filter((entry) => entry.kind === kind)
        .reduce((sum, entry) => sum + entry.charge.monthlyAmount, 0)
    );
  const totalMonthlyCost = monthlyTotal("subscription");

  const horizonEnd = new Date(today.getTime() + UPCOMING_HORIZON_DAYS * MS_PER_DAY);
  const upcomingCharges: UpcomingCharge[] = [];
  for (const { charge, kind } of activeCharges) {
    for (const occurrence of chargeOccurrences(charge, today, horizonEnd)) {
      upcomingCharges.push({
        key: charge.key,
        label: charge.label,
        amount: charge.averageAmount,
        date: occurrence.toISOString().slice(0, 10),
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
