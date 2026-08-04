import { describe, expect, it } from "vitest";

import {
  budgetProgress,
  budgetStatus,
  BUDGET_WARNING_RATIO,
  carryoverFor,
  MAX_ROLLOVER_MONTHS,
  monthKey,
  monthLabel,
  nextMonth,
  parsePeriod,
  periodOf,
  periodRange,
  previousMonth,
  shiftMonths,
  spendKey,
  summarizeBudgets,
  type BudgetPeriod,
  type BudgetRow,
  type SpendLookup,
} from "@/lib/personal/budgets";

const JUNE: BudgetPeriod = { year: 2026, month: 6 };

function budget(overrides: Partial<BudgetRow> = {}): BudgetRow {
  const row = {
    category: "Groceries",
    categoryId: "cat_groceries",
    limit: 500,
    month: JUNE.month,
    year: JUNE.year,
    rollover: false,
    ...overrides,
  };
  return { id: `${row.category}-${row.year}-${row.month}`, ...row };
}

interface SpendEntry {
  category?: string;
  year?: number;
  month: number;
  amount: number;
}

function spendOf(...entries: SpendEntry[]): SpendLookup {
  return new Map(
    entries.map((entry) => [
      spendKey(entry.category ?? "Groceries", {
        year: entry.year ?? JUNE.year,
        month: entry.month,
      }),
      entry.amount,
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Spend against a single budget                                       */
/* ------------------------------------------------------------------ */

describe("budget progress", () => {
  it("reports spent, remaining and the ratio for a plain month", () => {
    const row = budget({ limit: 400 });
    const progress = budgetProgress(row, [row], spendOf({ month: 6, amount: 100 }));

    expect(progress.limit).toBe(400);
    expect(progress.carriedOver).toBe(0);
    expect(progress.available).toBe(400);
    expect(progress.spent).toBe(100);
    expect(progress.remaining).toBe(300);
    expect(progress.ratio).toBeCloseTo(0.25);
    expect(progress.status).toBe("under");
  });

  it("treats a month with no matching spend as untouched", () => {
    const row = budget({ limit: 250 });
    const progress = budgetProgress(row, [row], spendOf({ category: "Transport", month: 6, amount: 90 }));

    expect(progress.spent).toBe(0);
    expect(progress.remaining).toBe(250);
    expect(progress.ratio).toBe(0);
  });

  it("carries the category and period through unchanged", () => {
    const row = budget({ category: "Dining", categoryId: "cat_dining", limit: 120 });
    const progress = budgetProgress(row, [row], spendOf({ category: "Dining", month: 6, amount: 30 }));

    expect(progress.category).toBe("Dining");
    expect(progress.categoryId).toBe("cat_dining");
    expect(progress.year).toBe(2026);
    expect(progress.month).toBe(6);
  });

  it("goes negative rather than clamping once the limit is passed", () => {
    const row = budget({ limit: 200 });
    const progress = budgetProgress(row, [row], spendOf({ month: 6, amount: 275 }));

    expect(progress.remaining).toBe(-75);
    expect(progress.ratio).toBeCloseTo(1.375);
    expect(progress.status).toBe("over");
  });
});

/* ------------------------------------------------------------------ */
/* Status thresholds                                                   */
/* ------------------------------------------------------------------ */

describe("budget status thresholds", () => {
  it("warns exactly at the warning ratio and not a penny before", () => {
    expect(BUDGET_WARNING_RATIO).toBe(0.85);
    expect(budgetStatus(84.99, 100)).toBe("under");
    expect(budgetStatus(85, 100)).toBe("warning");
    expect(budgetStatus(85.01, 100)).toBe("warning");
  });

  it("keeps spending the whole budget out of 'over'", () => {
    expect(budgetStatus(100, 100)).toBe("warning");
    expect(budgetStatus(100.01, 100)).toBe("over");
  });

  it("treats an untouched budget as under", () => {
    expect(budgetStatus(0, 100)).toBe("under");
  });
});

/* ------------------------------------------------------------------ */
/* Nothing left to spend                                               */
/* ------------------------------------------------------------------ */

describe("budgets with nothing available", () => {
  it("reports a ratio of 0 rather than dividing by zero", () => {
    expect(budgetStatus(0, 0)).toBe("under");

    const row = budget({ limit: 300, rollover: true });
    const previous = budget({ limit: 300, month: 5, rollover: true });
    const progress = budgetProgress(
      row,
      [row, previous],
      spendOf({ month: 5, amount: 600 }, { month: 6, amount: 10 })
    );

    expect(progress.carriedOver).toBe(-300);
    expect(progress.available).toBe(0);
    expect(progress.ratio).toBe(0);
    expect(progress.remaining).toBe(-10);
    expect(progress.status).toBe("over");
  });

  it("handles an available amount pushed below zero by an overspend", () => {
    const row = budget({ limit: 100, rollover: true });
    const previous = budget({ limit: 100, month: 5, rollover: true });
    const progress = budgetProgress(
      row,
      [row, previous],
      spendOf({ month: 5, amount: 250 }, { month: 6, amount: 20 })
    );

    expect(progress.available).toBe(-50);
    expect(progress.ratio).toBe(0);
    expect(progress.remaining).toBe(-70);
    expect(progress.status).toBe("over");
  });
});

/* ------------------------------------------------------------------ */
/* Rollover chains                                                     */
/* ------------------------------------------------------------------ */

describe("rollover", () => {
  it("carries an underspend into the next month", () => {
    const may = budget({ month: 5, rollover: true });
    const june = budget({ rollover: true });
    const progress = budgetProgress(june, [may, june], spendOf({ month: 5, amount: 400 }));

    expect(progress.carriedOver).toBe(100);
    expect(progress.available).toBe(600);
    expect(progress.remaining).toBe(600);
  });

  it("lets an overspend eat into the next month", () => {
    const may = budget({ month: 5, rollover: true });
    const june = budget({ rollover: true });
    const progress = budgetProgress(
      june,
      [may, june],
      spendOf({ month: 5, amount: 700 }, { month: 6, amount: 100 })
    );

    expect(progress.carriedOver).toBe(-200);
    expect(progress.available).toBe(300);
    expect(progress.remaining).toBe(200);
    expect(progress.status).toBe("under");
  });

  it("accumulates a multi-month chain oldest first", () => {
    const rows = [
      budget({ month: 3, rollover: true }),
      budget({ month: 4, rollover: true }),
      budget({ month: 5, rollover: true }),
      budget({ rollover: true }),
    ];
    const spend = spendOf(
      { month: 3, amount: 400 },
      { month: 4, amount: 450 },
      { month: 5, amount: 300 },
      { month: 6, amount: 200 }
    );

    // 100 left in March, 150 by April, 350 by May.
    expect(carryoverFor(rows, spend, "Groceries", { year: 2026, month: 4 })).toBe(100);
    expect(carryoverFor(rows, spend, "Groceries", { year: 2026, month: 5 })).toBe(150);
    expect(carryoverFor(rows, spend, "Groceries", JUNE)).toBe(350);

    const progress = budgetProgress(rows[3]!, rows, spend);
    expect(progress.available).toBe(850);
    expect(progress.remaining).toBe(650);
  });

  it("stops at a month that does not roll over", () => {
    const rows = [
      budget({ month: 4, rollover: true }),
      budget({ month: 5, rollover: false }),
      budget({ rollover: true }),
    ];
    const spend = spendOf({ month: 4, amount: 100 }, { month: 5, amount: 200 });

    // May breaks the chain, so April's 400 surplus never reaches June.
    expect(carryoverFor(rows, spend, "Groceries", JUNE)).toBe(0);
  });

  it("stops at a month with no budget at all", () => {
    const rows = [budget({ month: 4, rollover: true }), budget({ rollover: true })];
    const spend = spendOf({ month: 4, amount: 100 });

    expect(carryoverFor(rows, spend, "Groceries", JUNE)).toBe(0);
  });

  it("ignores other categories' history", () => {
    const rows = [
      budget({ category: "Dining", month: 5, limit: 900, rollover: true }),
      budget({ month: 5, rollover: true }),
      budget({ rollover: true }),
    ];
    const spend = spendOf(
      { category: "Dining", month: 5, amount: 0 },
      { month: 5, amount: 450 }
    );

    expect(carryoverFor(rows, spend, "Groceries", JUNE)).toBe(50);
  });

  it("carries nothing when the budget itself has rollover off", () => {
    const may = budget({ month: 5, rollover: true });
    const june = budget({ rollover: false });
    const progress = budgetProgress(june, [may, june], spendOf({ month: 5, amount: 100 }));

    expect(progress.carriedOver).toBe(0);
    expect(progress.available).toBe(500);
  });

  it("walks back no further than the rollover bound", () => {
    const rows: BudgetRow[] = [];
    let cursor: BudgetPeriod = JUNE;
    for (let step = 0; step <= MAX_ROLLOVER_MONTHS + 6; step += 1) {
      rows.push(budget({ limit: 100, year: cursor.year, month: cursor.month, rollover: true }));
      cursor = previousMonth(cursor);
    }

    // Every month underspent its whole 100, but only 24 of them can reach June.
    expect(carryoverFor(rows, new Map(), "Groceries", JUNE)).toBe(100 * MAX_ROLLOVER_MONTHS);
  });
});

/* ------------------------------------------------------------------ */
/* Month summary                                                       */
/* ------------------------------------------------------------------ */

describe("summarizeBudgets", () => {
  const rows = [
    budget({ limit: 500 }),
    budget({ category: "Transport", limit: 200 }),
    budget({ category: "Dining", limit: 100 }),
    budget({ category: "Transport", month: 5, limit: 999 }),
  ];
  const spend = spendOf(
    { month: 6, amount: 600 },
    { category: "Transport", month: 6, amount: 100 },
    { category: "Dining", month: 6, amount: 90 },
    { category: "Transport", month: 5, amount: 5 }
  );

  it("totals the month and counts what is over", () => {
    const summary = summarizeBudgets(rows, spend, JUNE);

    expect(summary.budgets).toHaveLength(3);
    expect(summary.totalLimit).toBe(800);
    expect(summary.totalAvailable).toBe(800);
    expect(summary.totalSpent).toBe(790);
    expect(summary.totalRemaining).toBe(10);
    expect(summary.overCount).toBe(1);
    expect(summary.ratio).toBeCloseTo(0.9875);
  });

  it("keeps other months out of the month being shown", () => {
    const summary = summarizeBudgets(rows, spend, JUNE);
    expect(summary.budgets.every((entry) => entry.month === 6 && entry.year === 2026)).toBe(true);
    // May's Transport budget of 999 is history for the rollover chain only.
    expect(summary.budgets.map((entry) => entry.limit)).not.toContain(999);
  });

  it("orders by spend, then alphabetically", () => {
    const summary = summarizeBudgets(rows, spend, JUNE);
    expect(summary.budgets.map((entry) => entry.category)).toEqual([
      "Groceries",
      "Transport",
      "Dining",
    ]);

    const tied = summarizeBudgets(
      [budget({ category: "Travel" }), budget({ category: "Bills" })],
      spendOf({ category: "Travel", month: 6, amount: 50 }, { category: "Bills", month: 6, amount: 50 }),
      JUNE
    );
    expect(tied.budgets.map((entry) => entry.category)).toEqual(["Bills", "Travel"]);
  });

  it("gives each budget its own status", () => {
    const summary = summarizeBudgets(rows, spend, JUNE);
    const byCategory = new Map(summary.budgets.map((entry) => [entry.category, entry.status]));

    expect(byCategory.get("Groceries")).toBe("over");
    expect(byCategory.get("Transport")).toBe("under");
    expect(byCategory.get("Dining")).toBe("warning");
  });

  it("includes rollover in the available total but not in the limit total", () => {
    const summary = summarizeBudgets(
      [budget({ month: 5, rollover: true }), budget({ rollover: true })],
      spendOf({ month: 5, amount: 300 }),
      JUNE
    );

    expect(summary.totalLimit).toBe(500);
    expect(summary.totalAvailable).toBe(700);
    expect(summary.totalRemaining).toBe(700);
  });

  it("returns zeroed totals for a month with no budgets", () => {
    const summary = summarizeBudgets([], new Map(), JUNE);

    expect(summary.budgets).toEqual([]);
    expect(summary.totalLimit).toBe(0);
    expect(summary.totalAvailable).toBe(0);
    expect(summary.totalSpent).toBe(0);
    expect(summary.totalRemaining).toBe(0);
    expect(summary.overCount).toBe(0);
    expect(summary.ratio).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Month arithmetic                                                    */
/* ------------------------------------------------------------------ */

describe("month arithmetic", () => {
  it("steps backwards across a year boundary", () => {
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
    expect(previousMonth({ year: 2026, month: 3 })).toEqual({ year: 2026, month: 2 });
  });

  it("steps forwards across a year boundary", () => {
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    expect(nextMonth({ year: 2026, month: 11 })).toEqual({ year: 2026, month: 12 });
  });

  it("shifts by whole months in either direction", () => {
    expect(shiftMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonths(JUNE, -MAX_ROLLOVER_MONTHS)).toEqual({ year: 2024, month: 6 });
    expect(shiftMonths(JUNE, 0)).toEqual(JUNE);
  });

  it("bounds December and January to their own months", () => {
    expect(periodRange({ year: 2026, month: 12 })).toEqual({
      start: new Date("2026-12-01T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(periodRange({ year: 2026, month: 1 })).toEqual({
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("puts the last instant of a month in that month", () => {
    expect(periodOf(new Date("2026-01-31T23:59:59.999Z"))).toEqual({ year: 2026, month: 1 });
    expect(periodOf(new Date("2026-12-01T00:00:00.000Z"))).toEqual({ year: 2026, month: 12 });
  });

  it("builds padded, sortable keys", () => {
    expect(monthKey({ year: 2026, month: 1 })).toBe("2026-01");
    expect(monthKey({ year: 2026, month: 12 })).toBe("2026-12");
    expect(spendKey("Groceries", JUNE)).toBe("Groceries|2026-06");
  });

  it("labels a month in words", () => {
    expect(monthLabel({ year: 2026, month: 1 })).toBe("January 2026");
    expect(monthLabel({ year: 2026, month: 12 })).toBe("December 2026");
  });
});

/* ------------------------------------------------------------------ */
/* Untrusted period parameters                                         */
/* ------------------------------------------------------------------ */

describe("parsePeriod", () => {
  it("accepts a valid pair", () => {
    expect(parsePeriod("2025", "11", JUNE)).toEqual({ year: 2025, month: 11 });
  });

  it("falls back per field so a half-written URL still resolves", () => {
    expect(parsePeriod(undefined, "3", JUNE)).toEqual({ year: 2026, month: 3 });
    expect(parsePeriod("2024", undefined, JUNE)).toEqual({ year: 2024, month: 6 });
    expect(parsePeriod(undefined, undefined, JUNE)).toEqual(JUNE);
  });

  it("rejects out-of-range and nonsense values", () => {
    expect(parsePeriod("2026", "0", JUNE)).toEqual(JUNE);
    expect(parsePeriod("2026", "13", JUNE)).toEqual(JUNE);
    expect(parsePeriod("1999", "6", JUNE)).toEqual(JUNE);
    expect(parsePeriod("2101", "6", JUNE)).toEqual(JUNE);
    expect(parsePeriod("last-year", "june", JUNE)).toEqual(JUNE);
    expect(parsePeriod("2026.5", "6.5", JUNE)).toEqual(JUNE);
    expect(parsePeriod("", "", JUNE)).toEqual(JUNE);
  });
});
