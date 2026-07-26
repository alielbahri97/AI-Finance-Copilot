/**
 * Smoke test for the forecast engine: builds a year of synthetic history
 * (recurring salary/rent/subscriptions + noise-free variable spend) and
 * checks runway, recurring detection, scheduling, and assumption handling.
 *
 * Run with: npx tsx scripts/forecast-smoke-test.ts
 */
import { computeForecast, type AssumptionInput } from "../src/lib/finance/forecast";
import { detectRecurring, type FinanceTransaction } from "../src/lib/finance/recurrence";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27

function buildHistory(): FinanceTransaction[] {
  const txs: FinanceTransaction[] = [];
  for (let back = 12; back >= 1; back--) {
    const year = NOW.getUTCFullYear();
    const month = NOW.getUTCMonth() - back;
    // Salary: 5000 on the 25th.
    txs.push({
      type: "INCOME",
      amount: 5000,
      date: new Date(Date.UTC(year, month, 25)),
      description: "Salary payment",
      counterparty: "ACME Corp",
      category: "Salary",
    });
    // Rent: 2000 on the 1st.
    txs.push({
      type: "EXPENSE",
      amount: 2000,
      date: new Date(Date.UTC(year, month, 1)),
      description: "Monthly rent",
      counterparty: "City Apartments",
      category: "Housing",
    });
    // Subscription: 15 on the 10th.
    txs.push({
      type: "EXPENSE",
      amount: 15,
      date: new Date(Date.UTC(year, month, 10)),
      description: "Streaming subscription",
      counterparty: "Netflix",
      category: "Subscriptions",
    });
    // Variable groceries: 4 purchases with strongly varying amounts so the
    // stable-amount check rejects them (~800/month on average).
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

console.log("recurrence detection");
{
  const items = detectRecurring(buildHistory());
  const salary = items.find((item) => item.label === "ACME Corp");
  const rent = items.find((item) => item.label === "City Apartments");
  const netflix = items.find((item) => item.label === "Netflix");
  check("detects salary as recurring income", salary?.type === "INCOME" && salary.cadence === "monthly");
  check("detects rent as monthly", rent?.cadence === "monthly");
  check("rent monthly amount ~2000", Math.abs((rent?.monthlyAmount ?? 0) - 2000) < 150);
  check("detects small subscription", netflix !== undefined);
  check("groceries not detected as recurring (varied merchants)", !items.some((item) => item.category === "Groceries"));
}

console.log("baseline forecast (no assumptions)");
{
  const result = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [],
    currency: "USD",
    now: NOW,
  });
  const m = result.metrics;
  // Monthly: income 5000, expenses 2000+15+800=2815 → net +2185.
  check("net is positive so runway is infinite", m.runwayMonths === null, `runway=${m.runwayMonths}`);
  check("gross burn ~2815", Math.abs(m.grossBurnRate - 2815) < 200, `gross=${m.grossBurnRate}`);
  check("net burn ~-2185 (adding cash)", Math.abs(m.netBurnRate + 2185) < 200, `net=${m.netBurnRate}`);
  check(
    "30d projection grows roughly one month of net",
    m.projectedBalance30d > result.currentBalance + 1000 &&
      m.projectedBalance30d < result.currentBalance + 3500,
    `balance=${result.currentBalance}, 30d=${m.projectedBalance30d}`
  );
  check("12m projection > 90d projection", m.projectedBalance12m > m.projectedBalance90d);
  check("upcoming bills include rent", result.upcomingBills.some((bill) => bill.label === "City Apartments"));
  check(
    "d30 has ~61 points (30 hist + boundary + 30 fwd)",
    result.horizons.d30.length >= 59 && result.horizons.d30.length <= 62,
    `len=${result.horizons.d30.length}`
  );
  check(
    "m12 series ends ~12 months out",
    result.horizons.m12.filter((p) => p.projected !== null).length >= 12
  );
  const firstProjected = result.horizons.d30.find((p) => p.actual === null && p.projected !== null);
  check("projection has confidence band", firstProjected?.band !== null && firstProjected !== undefined);
}

console.log("assumptions");
{
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

  const base = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [],
    currency: "USD",
    now: NOW,
  });
  const withHire = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [bigHire],
    currency: "USD",
    now: NOW,
  });
  const withBoth = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [bigHire, invoice],
    currency: "USD",
    now: NOW,
  });
  const disabled = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [{ ...bigHire, enabled: false }],
    currency: "USD",
    now: NOW,
  });

  // Net was +2185/mo; a 6000/mo hire makes it roughly -3815/mo → finite runway.
  check("hire makes runway finite", withHire.metrics.runwayMonths !== null, `runway=${withHire.metrics.runwayMonths}`);
  check(
    "runway in a plausible range (3-12 months)",
    (withHire.metrics.runwayMonths ?? 0) > 3 && (withHire.metrics.runwayMonths ?? 99) < 12,
    `runway=${withHire.metrics.runwayMonths}`
  );
  check(
    "one-off invoice lifts 90d balance by ~12000",
    Math.abs(withBoth.metrics.projectedBalance90d - withHire.metrics.projectedBalance90d - 12_000) < 200,
    `diff=${withBoth.metrics.projectedBalance90d - withHire.metrics.projectedBalance90d}`
  );
  check(
    "disabled assumption has no effect",
    Math.abs(disabled.metrics.projectedBalance90d - base.metrics.projectedBalance90d) < 1
  );
  check(
    "hire shows up in upcoming bills as assumption",
    withHire.upcomingBills.some((bill) => bill.label === "New hire" && bill.source === "assumption")
  );

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
  const withGrowth = computeForecast({
    transactions: buildHistory(),
    priorNet: 10_000,
    assumptions: [growth],
    currency: "USD",
    now: NOW,
  });
  check(
    "expense growth lowers the 12m projection",
    withGrowth.metrics.projectedBalance12m < base.metrics.projectedBalance12m - 1000,
    `base=${base.metrics.projectedBalance12m}, growth=${withGrowth.metrics.projectedBalance12m}`
  );
}

console.log("empty history");
{
  const result = computeForecast({
    transactions: [],
    priorNet: 0,
    assumptions: [],
    currency: "USD",
    now: NOW,
  });
  check("zero balance → zero runway", result.metrics.runwayMonths === 0);
  check("no recurring items", result.recurringExpenses.length === 0 && result.recurringIncome.length === 0);
  check("projections stay at zero", result.metrics.projectedBalance12m === 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll forecast smoke tests passed");
