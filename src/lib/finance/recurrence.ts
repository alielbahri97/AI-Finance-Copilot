/**
 * Recurring-transaction detection shared by the AI copilot context layer and
 * the cash-flow forecast engine. Pure functions — no database access.
 */

export interface FinanceTransaction {
  type: "INCOME" | "EXPENSE";
  amount: number;
  date: Date;
  description: string;
  counterparty: string | null;
  category: string;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly";

export interface RecurringItem {
  key: string;
  label: string;
  category: string;
  type: "INCOME" | "EXPENSE";
  averageAmount: number;
  cadence: Cadence;
  /** Canonical interval used for scheduling projections. */
  intervalDays: number;
  timesSeen: number;
  monthsSeen: number;
  /** ISO date of the most recent occurrence. */
  lastDate: string;
  /** Average amount converted to a monthly equivalent. */
  monthlyAmount: number;
}

/** Mean month length, used to normalise any cadence to a monthly equivalent. */
export const DAYS_PER_MONTH = 30.44;

const CADENCES: { cadence: Cadence; min: number; max: number; canonical: number }[] = [
  { cadence: "weekly", min: 5, max: 10, canonical: 7 },
  { cadence: "biweekly", min: 11, max: 18, canonical: 14 },
  { cadence: "monthly", min: 19, max: 45, canonical: DAYS_PER_MONTH },
  { cadence: "quarterly", min: 46, max: 120, canonical: 91.3 },
];

/** Normalizes a merchant/description string so recurring payments group together. */
export function normalizeMerchant(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function stdDev(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Detects recurring income and expense patterns: groups transactions by a
 * normalized merchant key, then keeps groups with a stable amount
 * (coefficient of variation < 0.35) and a consistent payment interval.
 */
export function detectRecurring(transactions: FinanceTransaction[]): RecurringItem[] {
  const groups = new Map<
    string,
    { label: string; category: string; type: "INCOME" | "EXPENSE"; amounts: number[]; dates: Date[] }
  >();

  for (const tx of transactions) {
    const merchantKey = normalizeMerchant(tx.counterparty?.trim() || tx.description);
    if (merchantKey.length < 3) continue;
    const key = `${tx.type}:${merchantKey}`;
    const group = groups.get(key) ?? {
      label: tx.counterparty?.trim() || tx.description,
      category: tx.category,
      type: tx.type,
      amounts: [],
      dates: [],
    };
    group.amounts.push(tx.amount);
    group.dates.push(tx.date);
    groups.set(key, group);
  }

  const items: RecurringItem[] = [];

  for (const [key, group] of groups) {
    if (group.amounts.length < 3) continue;

    const monthsSeen = new Set(group.dates.map(monthKeyOf)).size;
    if (monthsSeen < 2) continue;

    const averageAmount = mean(group.amounts);
    if (averageAmount <= 0) continue;
    if (stdDev(group.amounts, averageAmount) / averageAmount > 0.35) continue;

    const sortedDates = [...group.dates].sort((a, b) => a.getTime() - b.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sortedDates.length; i++) {
      const gap = (sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / MS_PER_DAY;
      if (gap > 0.5) gaps.push(gap);
    }
    if (gaps.length < 2) continue;

    const typicalGap = median(gaps);
    const match = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max);
    if (!match) continue;

    items.push({
      key,
      label: group.label,
      category: group.category,
      type: group.type,
      averageAmount: Math.round(averageAmount * 100) / 100,
      cadence: match.cadence,
      intervalDays: match.canonical,
      timesSeen: group.amounts.length,
      monthsSeen,
      lastDate: sortedDates[sortedDates.length - 1].toISOString().slice(0, 10),
      monthlyAmount: Math.round(((averageAmount * DAYS_PER_MONTH) / match.canonical) * 100) / 100,
    });
  }

  return items.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

/**
 * Projects the next occurrence dates of a recurring item within [from, to].
 * If the item is overdue (next expected date already passed), the schedule is
 * rolled forward so the first projection lands on or after `from`.
 *
 * Takes only the two fields it schedules from, so a caller holding a derived
 * summary of an item can project from it without reconstructing the item.
 */
export function nextOccurrences(
  item: Pick<RecurringItem, "lastDate" | "intervalDays">,
  from: Date,
  to: Date
): Date[] {
  const occurrences: Date[] = [];
  const intervalMs = item.intervalDays * MS_PER_DAY;
  let next = new Date(`${item.lastDate}T00:00:00.000Z`).getTime() + intervalMs;

  // Roll forward past the window start (handles stale/overdue items).
  if (next < from.getTime()) {
    const missed = Math.ceil((from.getTime() - next) / intervalMs);
    next += missed * intervalMs;
  }

  let guard = 0;
  while (next <= to.getTime() && guard < 400) {
    occurrences.push(new Date(next));
    next += intervalMs;
    guard++;
  }
  return occurrences;
}
