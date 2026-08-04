import { describe, expect, it } from "vitest";

import type { FinanceTransaction } from "@/lib/finance/recurrence";
import {
  analyzeSubscriptions,
  classifySubscriptionKind,
  detectPriceChange,
  PRICE_CHANGE_MIN_AMOUNT,
  PRICE_CHANGE_MIN_PERCENT,
  REVIEW_MAX_MONTHLY_AMOUNT,
  REVIEW_MIN_CHARGES,
  UPCOMING_HORIZON_DAYS,
  type DetectedSubscription,
} from "@/lib/personal/subscriptions";

const NOW = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ChargeSpec {
  label: string;
  category: string;
  /** Charge amounts oldest-to-newest, spread evenly across `count`. */
  amounts: number[];
  intervalDays: number;
  count: number;
  /** Age in days of the most recent charge. */
  lastChargedDaysAgo: number;
}

/** Builds an evenly spaced run of charges for one merchant, oldest first. */
function charges(spec: ChargeSpec): FinanceTransaction[] {
  const transactions: FinanceTransaction[] = [];
  for (let index = 0; index < spec.count; index++) {
    const stepsBack = spec.count - 1 - index;
    const daysAgo = spec.lastChargedDaysAgo + stepsBack * spec.intervalDays;
    const slot = Math.floor((index * spec.amounts.length) / spec.count);
    transactions.push({
      type: "EXPENSE",
      amount: spec.amounts[slot],
      date: new Date(NOW.getTime() - daysAgo * MS_PER_DAY),
      description: `${spec.label} payment`,
      counterparty: spec.label,
      category: spec.category,
    });
  }
  return transactions;
}

/**
 * A personal year of history: clean subscriptions at three cadences, price
 * moves either side of both thresholds, one charge that stopped, the three
 * ways the review profile fails, and two bills that must not be mistaken for
 * subscriptions.
 */
function buildHistory(): FinanceTransaction[] {
  return [
    // Clean monthly, priced above the review ceiling so it carries no flags.
    ...charges({
      label: "Netflix",
      category: "Subscriptions",
      amounts: [24.99],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 5,
    }),
    ...charges({
      label: "Cycle Studio",
      category: "Health",
      amounts: [5],
      intervalDays: 7,
      count: 10,
      lastChargedDaysAgo: 3,
    }),
    ...charges({
      label: "Domain Registrar",
      category: "Subscriptions",
      amounts: [60],
      intervalDays: 91,
      count: 4,
      lastChargedDaysAgo: 10,
    }),
    // 9.99 for the first half of the run, 12.99 for the second.
    ...charges({
      label: "Streaming Plus",
      category: "Entertainment",
      amounts: [9.99, 12.99],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 4,
    }),
    // +0.50 on 20.00: clears the absolute threshold, not the relative one.
    ...charges({
      label: "News Digest",
      category: "Education",
      amounts: [20, 20.5],
      intervalDays: 30,
      count: 6,
      lastChargedDaysAgo: 6,
    }),
    // +10% on 4.00: clears the relative threshold, not the absolute one.
    ...charges({
      label: "Podcast Feed",
      category: "Entertainment",
      amounts: [4, 4.4],
      intervalDays: 30,
      count: 6,
      lastChargedDaysAgo: 8,
    }),
    // Last charged two months ago on a monthly cadence.
    ...charges({
      label: "Old Gym",
      category: "Health",
      amounts: [29.99],
      intervalDays: 30,
      count: 5,
      lastChargedDaysAgo: 60,
    }),
    // Matches every review condition.
    ...charges({
      label: "Cloud Backup",
      category: "Subscriptions",
      amounts: [4.99],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 7,
    }),
    // Cheap and unchanged, but too few charges to have been forgotten.
    ...charges({
      label: "Photo Cloud",
      category: "Subscriptions",
      amounts: [3.99],
      intervalDays: 30,
      count: 4,
      lastChargedDaysAgo: 9,
    }),
    // Long-running and unchanged, but too expensive to go unnoticed.
    ...charges({
      label: "Design Suite",
      category: "Subscriptions",
      amounts: [39],
      intervalDays: 30,
      count: 9,
      lastChargedDaysAgo: 11,
    }),
    ...charges({
      label: "City Apartments",
      category: "Housing",
      amounts: [1450],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 12,
    }),
    ...charges({
      label: "Energy Co",
      category: "Utilities",
      amounts: [90],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 14,
    }),
    // A category the app never seeds: must still count as a subscription.
    ...charges({
      label: "Coffee Club",
      category: "Hobbies",
      amounts: [18],
      intervalDays: 30,
      count: 6,
      lastChargedDaysAgo: 13,
    }),
  ];
}

const analysis = analyzeSubscriptions(buildHistory(), NOW);

function find(label: string): DetectedSubscription {
  const item = [...analysis.subscriptions, ...analysis.bills].find(
    (entry) => entry.label === label
  );
  expect(item, `expected ${label} to be detected`).toBeDefined();
  return item as DetectedSubscription;
}

/* ------------------------------------------------------------------ */
/* Detection and monthly normalisation                                 */
/* ------------------------------------------------------------------ */

describe("subscription detection", () => {
  it("detects a clean monthly subscription with its monthly cost and next charge", () => {
    const netflix = find("Netflix");
    expect(netflix.cadence).toBe("monthly");
    expect(netflix.timesSeen).toBe(8);
    expect(netflix.averageAmount).toBe(24.99);
    expect(netflix.monthlyAmount).toBe(24.99);
    expect(netflix.lastChargedAt).toBe("2026-07-22");
    expect(netflix.nextChargeAt).toBe("2026-08-21");
    expect(netflix.flags).toEqual([]);
  });

  it("normalises a weekly charge to its monthly equivalent", () => {
    const weekly = find("Cycle Studio");
    expect(weekly.cadence).toBe("weekly");
    expect(weekly.averageAmount).toBe(5);
    // 5 a week over an average 30.44-day month.
    expect(weekly.monthlyAmount).toBeCloseTo(21.74, 2);
  });

  it("normalises a quarterly charge to its monthly equivalent", () => {
    const quarterly = find("Domain Registrar");
    expect(quarterly.cadence).toBe("quarterly");
    expect(quarterly.averageAmount).toBe(60);
    // 60 a quarter is a third of that per month.
    expect(quarterly.monthlyAmount).toBeCloseTo(20, 1);
  });

  it("needs more than a couple of charges before it guesses", () => {
    const thin = analyzeSubscriptions(
      charges({
        label: "Brand New Service",
        category: "Subscriptions",
        amounts: [11],
        intervalDays: 30,
        count: 2,
        lastChargedDaysAgo: 4,
      }),
      NOW
    );
    expect(thin.subscriptions).toHaveLength(0);
    expect(thin.bills).toHaveLength(0);
    expect(thin.totalMonthlyCost).toBe(0);
    expect(thin.upcomingCharges).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Price changes                                                       */
/* ------------------------------------------------------------------ */

describe("price changes", () => {
  it("reports a rise from the first to the latest charge", () => {
    const item = find("Streaming Plus");
    expect(item.priceChange).toEqual({ from: 9.99, to: 12.99, percent: 30.03 });
    expect(item.flags).toContain("price_increase");
  });

  it("ignores a move that clears the absolute threshold but not the relative one", () => {
    const item = find("News Digest");
    expect(item.priceChange).toBeNull();
    expect(item.flags).not.toContain("price_increase");
  });

  it("ignores a move that clears the relative threshold but not the absolute one", () => {
    const item = find("Podcast Feed");
    expect(item.priceChange).toBeNull();
    expect(item.flags).not.toContain("price_increase");
  });

  it("compares only the ends of the amount history", () => {
    expect(detectPriceChange([10, 40, 10])).toBeNull();
    expect(detectPriceChange([10, 40, 20])).toEqual({ from: 10, to: 20, percent: 100 });
  });

  it("needs both thresholds to be cleared", () => {
    const justUnderPercent = 100 * (1 + (PRICE_CHANGE_MIN_PERCENT - 1) / 100);
    expect(detectPriceChange([100, justUnderPercent])).toBeNull();
    const justUnderAmount = 1 + (PRICE_CHANGE_MIN_AMOUNT - 0.1);
    expect(detectPriceChange([1, justUnderAmount])).toBeNull();
    expect(detectPriceChange([100, 120])).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Flags                                                               */
/* ------------------------------------------------------------------ */

describe("stopped subscriptions", () => {
  const stopped = find("Old Gym");

  it("flags a charge that is well past its interval", () => {
    expect(stopped.flags).toContain("overdue");
  });

  it("keeps it listed but out of the monthly total", () => {
    const active = analysis.subscriptions
      .filter((item) => !item.flags.includes("overdue"))
      .reduce((sum, item) => sum + item.monthlyAmount, 0);
    expect(analysis.subscriptions).toContain(stopped);
    expect(analysis.totalMonthlyCost).toBeCloseTo(active, 2);
    expect(analysis.totalMonthlyCost).toBeLessThan(active + stopped.monthlyAmount);
  });

  it("does not project charges for it", () => {
    expect(analysis.upcomingCharges.some((charge) => charge.label === "Old Gym")).toBe(false);
  });

  it("does not also ask the user to review it", () => {
    expect(stopped.flags).not.toContain("unused_looking");
  });
});

describe("subscriptions worth reviewing", () => {
  it("flags a small, long-running charge whose price never moved", () => {
    const item = find("Cloud Backup");
    expect(item.timesSeen).toBeGreaterThanOrEqual(REVIEW_MIN_CHARGES);
    expect(item.monthlyAmount).toBeLessThanOrEqual(REVIEW_MAX_MONTHLY_AMOUNT);
    expect(item.priceChange).toBeNull();
    expect(item.flags).toEqual(["unused_looking"]);
  });

  it("does not flag a charge with too short a history", () => {
    const item = find("Photo Cloud");
    expect(item.timesSeen).toBeLessThan(REVIEW_MIN_CHARGES);
    expect(item.flags).toEqual([]);
  });

  it("does not flag a charge whose price changed", () => {
    const item = find("Streaming Plus");
    expect(item.monthlyAmount).toBeLessThanOrEqual(REVIEW_MAX_MONTHLY_AMOUNT);
    expect(item.timesSeen).toBeGreaterThanOrEqual(REVIEW_MIN_CHARGES);
    expect(item.flags).not.toContain("unused_looking");
  });

  it("does not flag a charge too large to go unnoticed", () => {
    const item = find("Design Suite");
    expect(item.monthlyAmount).toBeGreaterThan(REVIEW_MAX_MONTHLY_AMOUNT);
    expect(item.timesSeen).toBeGreaterThanOrEqual(REVIEW_MIN_CHARGES);
    expect(item.flags).toEqual([]);
  });

  it("counts flagged subscriptions and leaves bills out of the count", () => {
    const flagged = analysis.subscriptions.filter((item) => item.flags.length > 0);
    expect(analysis.flaggedCount).toBe(flagged.length);
    expect(analysis.bills.every((item) => item.flags.length === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Bills versus subscriptions                                          */
/* ------------------------------------------------------------------ */

describe("bill classification", () => {
  it("treats housing and utilities as bills, not subscriptions", () => {
    expect(find("City Apartments").kind).toBe("bill");
    expect(find("Energy Co").kind).toBe("bill");
    expect(analysis.subscriptions.some((item) => item.label === "City Apartments")).toBe(false);
  });

  it("keeps bills out of the subscription total and in their own", () => {
    expect(analysis.totalMonthlyBills).toBeCloseTo(1450 + 90, 1);
    expect(analysis.totalMonthlyCost).toBeLessThan(analysis.totalMonthlyBills);
  });

  it("treats an unrecognised category as a subscription", () => {
    const custom = find("Coffee Club");
    expect(custom.category).toBe("Hobbies");
    expect(custom.kind).toBe("subscription");
  });

  it("matches bill category names case-insensitively", () => {
    expect(classifySubscriptionKind("Housing")).toBe("bill");
    expect(classifySubscriptionKind(" utilities ")).toBe("bill");
    expect(classifySubscriptionKind("INSURANCE")).toBe("bill");
    expect(classifySubscriptionKind("Loan repayments")).toBe("bill");
    expect(classifySubscriptionKind("Entertainment")).toBe("subscription");
    expect(classifySubscriptionKind("Book club")).toBe("subscription");
  });
});

/* ------------------------------------------------------------------ */
/* Upcoming charges and totals                                         */
/* ------------------------------------------------------------------ */

describe("upcoming charges", () => {
  const horizonEnd = new Date(NOW.getTime() + UPCOMING_HORIZON_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  it("stays inside the horizon", () => {
    expect(analysis.upcomingCharges.length).toBeGreaterThan(0);
    for (const charge of analysis.upcomingCharges) {
      expect(charge.date >= "2026-07-27").toBe(true);
      expect(charge.date <= horizonEnd).toBe(true);
    }
  });

  it("is sorted by date", () => {
    const dates = analysis.upcomingCharges.map((charge) => charge.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("omits a quarterly charge whose next date falls beyond the horizon", () => {
    const quarterly = find("Domain Registrar");
    expect(quarterly.nextChargeAt > horizonEnd).toBe(true);
    expect(analysis.upcomingCharges.some((charge) => charge.label === "Domain Registrar")).toBe(
      false
    );
  });

  it("repeats a weekly charge and includes bills alongside subscriptions", () => {
    const weekly = analysis.upcomingCharges.filter((charge) => charge.label === "Cycle Studio");
    expect(weekly).toHaveLength(4);
    expect(analysis.upcomingCharges.some((charge) => charge.kind === "bill")).toBe(true);
  });
});

describe("totals", () => {
  it("annualises the monthly subscription cost", () => {
    expect(analysis.annualisedCost).toBeCloseTo(analysis.totalMonthlyCost * 12, 2);
  });

  it("sums only active subscriptions", () => {
    const expected = analysis.subscriptions
      .filter((item) => !item.flags.includes("overdue"))
      .reduce((sum, item) => sum + item.monthlyAmount, 0);
    expect(analysis.totalMonthlyCost).toBeCloseTo(expected, 2);
  });
});
