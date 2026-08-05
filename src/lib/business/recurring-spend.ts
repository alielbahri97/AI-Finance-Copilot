/**
 * The Business edition's recurring-spend audit — pure logic, no database, no
 * AI calls.
 *
 * A company's recurring spend is a different question from a person's
 * subscriptions, even though the same detector answers both. A person asks
 * "what am I still paying for?"; a company asks "what does this vendor cost us
 * a year, how much of our spend is it, and are we paying two vendors to do one
 * job?". So this module adds three things to a measured recurring charge:
 *
 *   * annualised cost, and that cost as a share of everything the workspace
 *     spends — the two figures that make a €40/month tool arguable,
 *   * a price-creep flag on the same thresholds the personal feature uses, so
 *     the two editions never disagree about what counts as a rise,
 *   * overlap candidates: vendors an AI has labelled with the same coarse tool
 *     category, which is the one part of this file the transactions cannot
 *     answer on their own.
 *
 * The division of labour with the AI is deliberate and one-directional: every
 * amount, vendor, date and cadence comes from `detectRecurring`, and the model
 * only ever supplies a category name. It cannot move a number, and a wrong
 * label costs the user a badge that says "look at these two", not a wrong
 * total.
 */

import type { FinanceTransaction } from "@/lib/finance/recurrence";
import {
  annualisedCost,
  monthlyExpenseBase,
  PRICE_CHANGE_MIN_PERCENT,
  round2,
  summarizeRecurringCharges,
  type RecurringCharge,
} from "@/lib/finance/recurring-spend";

/**
 * How many vendors must share a tool category before it is worth raising.
 * Two is the point of the flag: one vendor per job is the healthy case.
 */
export const OVERLAP_MIN_VENDORS = 2;

/**
 * Expense categories that are not vendor spend, and are left off this page
 * entirely.
 *
 * A one-person company pays its owner every month from the same account it
 * pays for software, and the detector cannot tell the two apart — a salary is
 * a stable amount at a steady interval, which is exactly what it looks for.
 * Listing a director's own pay as a recurring vendor charge next to a badge
 * suggesting they consolidate it would be worse than useless, so payroll,
 * tax and internal transfers are excluded the same way the personal feature
 * separates bills from subscriptions: by category name, case-insensitively on
 * the trimmed name, with anything unrecognised treated as vendor spend.
 *
 * They stay in the denominator of "share of spend": they are real money out,
 * and a share of spend that ignored payroll would flatter every tool on the
 * page.
 */
export const INTERNAL_CATEGORY_NAMES: readonly string[] = [
  "salary",
  "salaries",
  "wages",
  "payroll",
  "staff costs",
  "owner draw",
  "owner drawings",
  "drawings",
  "dividend",
  "dividends",
  "tax",
  "taxes",
  "vat",
  "income tax",
  "corporation tax",
  "corporate tax",
  "payroll tax",
  "social security",
  "transfer",
  "transfers",
  "internal transfer",
];

/**
 * `price_creep` — the vendor charges materially more than it first did.
 * `overlap` — another vendor on the page does the same job, per the AI label.
 * `stopped` — nothing charged for well past the usual interval, so it is
 *   probably already cancelled and is left out of every total.
 */
export type RecurringSpendFlag = "price_creep" | "overlap" | "stopped";

export interface RecurringVendor extends RecurringCharge {
  /** `monthlyAmount` over a year, normalised for cadence. */
  annualisedCost: number;
  /**
   * This vendor's monthly cost as a percentage of the workspace's average
   * monthly expenses over the same history. 0 when there is no spend to
   * compare against.
   */
  expenseShare: number;
  /** The AI's coarse tool category, or null when nothing labelled it. */
  toolCategory: string | null;
  flags: RecurringSpendFlag[];
}

export interface OverlapGroup {
  /** The shared tool category, as the model wrote it. */
  toolCategory: string;
  /** Keys of the vendors sharing it, dearest first. */
  vendorKeys: string[];
  vendorLabels: string[];
  /** Combined monthly cost of the group. */
  monthlyAmount: number;
}

export interface RecurringSpendAudit {
  /** Vendor spend, dearest per month first. Stopped charges are listed last. */
  vendors: RecurringVendor[];
  /** Monthly equivalent of every active vendor charge. */
  totalMonthlyRecurring: number;
  /** The same figure over a year. */
  totalAnnualisedRecurring: number;
  /** Average monthly expenses across the loaded history, the share denominator. */
  monthlyExpenseBase: number;
  /** `totalMonthlyRecurring` as a percentage of `monthlyExpenseBase`. */
  recurringExpenseShare: number;
  /** Vendors carrying at least one flag. */
  flaggedCount: number;
  /** Tool categories with two or more active vendors. */
  overlapGroups: OverlapGroup[];
}

/** Whether a category name is the company paying itself or the state. */
export function isInternalCategory(category: string): boolean {
  return INTERNAL_CATEGORY_NAMES.includes(category.trim().toLowerCase());
}

/** A rise clearing the shared thresholds. A fall is not creep. */
function hasPriceCreep(charge: RecurringCharge): boolean {
  return charge.priceChange !== null && charge.priceChange.to > charge.priceChange.from;
}

function share(value: number, base: number): number {
  return base > 0 ? round2((value / base) * 100) : 0;
}

/**
 * Measures the workspace's recurring vendor spend. Deterministic: no AI is
 * involved, so `toolCategory` is null on every vendor and `overlapGroups` is
 * empty until {@link withToolCategories} is given labels.
 *
 * `now` is injected so the result is testable, and the transactions are
 * expected to be the same window the page loaded — the share denominator is
 * measured from them.
 */
export function analyzeRecurringSpend(
  transactions: FinanceTransaction[],
  now: Date
): RecurringSpendAudit {
  const expenseBase = monthlyExpenseBase(transactions, now);

  const vendors: RecurringVendor[] = summarizeRecurringCharges(transactions, now)
    .filter((charge) => !isInternalCategory(charge.category))
    .map((charge) => ({
      ...charge,
      annualisedCost: annualisedCost(charge.monthlyAmount),
      expenseShare: share(charge.monthlyAmount, expenseBase),
      toolCategory: null,
      flags: [
        ...(hasPriceCreep(charge) ? (["price_creep"] as const) : []),
        ...(charge.overdue ? (["stopped"] as const) : []),
      ],
    }))
    // Dearest first, but anything that looks cancelled sinks below what is
    // still being paid: the page is a list of decisions, and a stopped charge
    // is not one.
    .sort(
      (a, b) => Number(a.overdue) - Number(b.overdue) || b.monthlyAmount - a.monthlyAmount
    );

  const totalMonthlyRecurring = round2(
    vendors
      .filter((vendor) => !vendor.overdue)
      .reduce((sum, vendor) => sum + vendor.monthlyAmount, 0)
  );

  return {
    vendors,
    totalMonthlyRecurring,
    totalAnnualisedRecurring: annualisedCost(totalMonthlyRecurring),
    monthlyExpenseBase: expenseBase,
    recurringExpenseShare: share(totalMonthlyRecurring, expenseBase),
    flaggedCount: vendors.filter((vendor) => vendor.flags.length > 0).length,
    overlapGroups: [],
  };
}

/**
 * Applies AI tool-category labels to an audit and derives the overlap groups
 * from them: a category with two or more *active* vendors is a candidate for
 * consolidation. Stopped charges are ignored, because a cancelled tool is not
 * a duplicate of anything.
 *
 * Pure and total: an empty map (no AI key, a failed call, a model that
 * recognised nothing) returns the audit unchanged rather than a degraded one,
 * which is what makes the AI half of this feature optional.
 */
export function withToolCategories(
  audit: RecurringSpendAudit,
  labels: ReadonlyMap<string, string>
): RecurringSpendAudit {
  if (labels.size === 0) return audit;

  const labelled = audit.vendors.map((vendor) => ({
    ...vendor,
    toolCategory: labels.get(vendor.key) ?? null,
  }));

  const groups = new Map<string, RecurringVendor[]>();
  for (const vendor of labelled) {
    if (vendor.overdue || !vendor.toolCategory) continue;
    const members = groups.get(vendor.toolCategory) ?? [];
    members.push(vendor);
    groups.set(vendor.toolCategory, members);
  }

  const overlapping = new Set<string>();
  const overlapGroups: OverlapGroup[] = [];
  for (const [toolCategory, members] of groups) {
    if (members.length < OVERLAP_MIN_VENDORS) continue;
    for (const member of members) overlapping.add(member.key);
    overlapGroups.push({
      toolCategory,
      vendorKeys: members.map((member) => member.key),
      vendorLabels: members.map((member) => member.label),
      monthlyAmount: round2(members.reduce((sum, member) => sum + member.monthlyAmount, 0)),
    });
  }
  overlapGroups.sort((a, b) => b.monthlyAmount - a.monthlyAmount);

  const vendors = labelled.map((vendor) =>
    overlapping.has(vendor.key)
      ? { ...vendor, flags: [...vendor.flags, "overlap" as const] }
      : vendor
  );

  return {
    ...audit,
    vendors,
    flaggedCount: vendors.filter((vendor) => vendor.flags.length > 0).length,
    overlapGroups,
  };
}

/** The rise threshold, re-exported so the page can explain the badge it shows. */
export { PRICE_CHANGE_MIN_PERCENT as PRICE_CREEP_MIN_PERCENT };
