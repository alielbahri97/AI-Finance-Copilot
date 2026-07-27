import { describe, expect, it } from "vitest";

import { computeForecast, type AssumptionInput } from "@/lib/finance/forecast";
import { detectRecurring, type FinanceTransaction } from "@/lib/finance/recurrence";

const NOW = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27

/**
 * A year of synthetic history: recurring salary/rent/subscription plus
 * variable groceries that must NOT be detected as recurring.
 */
function buildHistory(): FinanceTransaction[] {
  const txs: FinanceTransaction[] = [];
  for (let back = 12; back >= 1; back--) {
    const year = NOW.getUTCFullYear();
    const month = NOW.getUTCMonth() - back;
    txs.push({
      type: "INCOME",
      amount: 5000,
      date: new Date(Date.UTC(year, month, 25)),
      description: "Salary payment",
      counterparty: "ACME Corp",
      category: "Salary",
    });
    txs.push({
      type: "EXPENSE",
      amount: 2000,
      date: new Date(Date.UTC(year, month, 1)),
      description: "Monthly rent",
      counterparty: "City Apartments",
      category: "Housing",
    });
    txs.push({
      type: "EXPENSE",
      amount: 15,
      date: new Date(Date.UTC(year, month, 10)),
      description: "Streaming subscription",
      counterparty: "Netflix",
      category: "Subscriptions",
    });
    for (let i = 0; i < 4; i++) {
      txs.push({
        type: "EXPENSE",
        amount: (back + i) % 2 === 0 ? 60 : 380,
        date: new Date(Date.UTC(year, month, 3 + i * 7)),
        description: `Groceries run ${back}-${i}`,
        counterparty: ["Corner Shop", "Green Market", "Mega Mart", "Farm Stand"][i],
        category: "Groceries",
      });
    }
  }
  return txs.filter((tx) => tx.date < NOW);
}

function forecast(assumptions: AssumptionInput[] = []) {
  return computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions,
    currency: "USD",
    now: NOW,
  });
}

describe("recurrence detection", () => {
  const items = detectRecurring(buildHistory());

  it("detects salary as recurring monthly income", () => {
    const salary = items.find((item) => item.label === "ACME Corp");
    expect(salary?.type).toBe("INCOME");
    expect(salary?.cadence).toBe("monthly");
  });

  it("detects rent as monthly with a ~2000 amount", () => {
    const rent = items.find((item) => item.label === "City Apartments");
    expect(rent?.cadence).toBe("monthly");
    expect(rent?.monthlyAmount).toBeGreaterThan(1850);
    expect(rent?.monthlyAmount).toBeLessThan(2150);
  });

  it("detects small subscriptions", () => {
    expect(items.find((item) => item.label === "Netflix")).toBeDefined();
  });

  it("does not flag varied groceries as recurring", () => {
    expect(items.some((item) => item.category === "Groceries")).toBe(false);
  });
});

describe("baseline forecast (trend + recurring scheduling)", () => {
  const result = forecast();
  const m = result.metrics;

  it("reports infinite runway while cash-flow positive", () => {
    // Monthly: income 5000, expenses ~2815 → net positive.
    expect(m.runwayMonths).toBeNull();
  });

  it("computes gross and net burn near the synthetic truth", () => {
    expect(Math.abs(m.grossBurnRate - 2815)).toBeLessThan(200);
    expect(Math.abs(m.netBurnRate + 2185)).toBeLessThan(200);
  });

  it("projects ~one month of net growth over 30 days", () => {
    expect(m.projectedBalance30d).toBeGreaterThan(result.currentBalance + 1000);
    expect(m.projectedBalance30d).toBeLessThan(result.currentBalance + 3500);
  });

  it("orders horizon projections consistently", () => {
    expect(m.projectedBalance12m).toBeGreaterThan(m.projectedBalance90d);
  });

  it("schedules rent in upcoming bills", () => {
    expect(result.upcomingBills.some((bill) => bill.label === "City Apartments")).toBe(true);
  });

  it("produces daily points for 30d and monthly points for 12m", () => {
    expect(result.horizons.d30.length).toBeGreaterThanOrEqual(59);
    expect(result.horizons.d30.length).toBeLessThanOrEqual(62);
    expect(result.horizons.m12.filter((p) => p.projected !== null).length).toBeGreaterThanOrEqual(
      12
    );
  });

  it("attaches a confidence band to projections", () => {
    const firstProjected = result.horizons.d30.find(
      (p) => p.actual === null && p.projected !== null
    );
    expect(firstProjected).toBeDefined();
    expect(firstProjected?.band).not.toBeNull();
  });
});

describe("assumptions", () => {
  const bigHire: AssumptionInput = {
    id: "a1",
    kind: "RECURRING",
    type: "EXPENSE",
    label: "New hire",
    amount: 6000,
    percent: null,
    date: null,
    startDate: new Date(Date.UTC(2026, 7, 1)),
    endDate: null,
    enabled: true,
  };
  const invoice: AssumptionInput = {
    id: "a2",
    kind: "ONE_OFF",
    type: "INCOME",
    label: "Invoice payment",
    amount: 12_000,
    percent: null,
    date: new Date(Date.UTC(2026, 7, 15)),
    startDate: null,
    endDate: null,
    enabled: true,
  };

  const base = forecast();
  const withHire = forecast([bigHire]);
  const withBoth = forecast([bigHire, invoice]);

  it("turns runway finite when a recurring expense flips net negative", () => {
    expect(withHire.metrics.runwayMonths).not.toBeNull();
    expect(withHire.metrics.runwayMonths!).toBeGreaterThan(3);
    expect(withHire.metrics.runwayMonths!).toBeLessThan(12);
  });

  it("applies one-off income on its date", () => {
    const diff = withBoth.metrics.projectedBalance90d - withHire.metrics.projectedBalance90d;
    expect(Math.abs(diff - 12_000)).toBeLessThan(200);
  });

  it("ignores disabled assumptions", () => {
    const disabled = forecast([{ ...bigHire, enabled: false }]);
    expect(
      Math.abs(disabled.metrics.projectedBalance90d - base.metrics.projectedBalance90d)
    ).toBeLessThan(1);
  });

  it("surfaces recurring assumptions as upcoming bills", () => {
    expect(
      withHire.upcomingBills.some(
        (bill) => bill.label === "New hire" && bill.source === "assumption"
      )
    ).toBe(true);
  });

  it("lets percentage growth compound against the projection", () => {
    const growth: AssumptionInput = {
      id: "a3",
      kind: "PERCENT_GROWTH",
      type: "EXPENSE",
      label: "Cost inflation",
      amount: null,
      percent: 5,
      date: null,
      startDate: null,
      endDate: null,
      enabled: true,
    };
    const withGrowth = forecast([growth]);
    expect(withGrowth.metrics.projectedBalance12m).toBeLessThan(
      base.metrics.projectedBalance12m - 1000
    );
  });
});

describe("empty history", () => {
  const result = computeForecast({
    transactions: [],
    priorNet: 0,
    assumptions: [],
    currency: "USD",
    now: NOW,
  });

  it("reports zero runway at zero balance", () => {
    expect(result.metrics.runwayMonths).toBe(0);
  });

  it("finds no recurring items", () => {
    expect(result.recurringExpenses).toHaveLength(0);
    expect(result.recurringIncome).toHaveLength(0);
  });

  it("keeps projections at zero", () => {
    expect(result.metrics.projectedBalance12m).toBe(0);
  });
});
