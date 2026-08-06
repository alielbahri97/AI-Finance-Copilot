import { describe, expect, it } from "vitest";

import { EDITION_PLAN_ORDER, getPlan } from "@/lib/billing/plans";
import { computeForecast, type AssumptionInput } from "@/lib/finance/forecast";
import type { FinanceTransaction } from "@/lib/finance/recurrence";
import {
  assumptionCopies,
  assumptionsInScenario,
  BASE_SCENARIO_ID,
  buildComparisonSeries,
  canAddScenario,
  MAX_COMPARED_SCENARIOS,
  nextCopyName,
  resolveActiveScenarioId,
  resolveComparedScenarioIds,
  scenarioColor,
  scenarioDeltas,
  scenarioSeriesKey,
  toScenarioColumn,
  toScenarioId,
  toScenarioSeries,
  type ComparedScenario,
  type ScenarioSummary,
} from "@/lib/finance/scenarios";

const NOW = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27

/**
 * The same synthetic year the forecast tests use: recurring salary/rent/
 * subscription plus variable groceries. Scenarios change nothing about the
 * history — that is the point of the feature, and of these tests.
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

const HISTORY = buildHistory();

function forecast(assumptions: AssumptionInput[]) {
  return computeForecast({
    transactions: HISTORY,
    priorNet: 10_000,
    assumptions,
    currency: "USD",
    now: NOW,
  });
}

/** An assumption row as the database holds it: with a scenario id, or without. */
function row(
  overrides: Partial<AssumptionInput> & { scenarioId: string | null; id: string }
): AssumptionInput & { scenarioId: string | null } {
  return {
    kind: "RECURRING",
    type: "EXPENSE",
    label: "Something",
    amount: 1000,
    percent: null,
    date: null,
    startDate: new Date(Date.UTC(2026, 7, 1)),
    endDate: null,
    enabled: true,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* The base scenario is NULL, and NULL is not "unset"                  */
/* ------------------------------------------------------------------ */

describe("the base scenario", () => {
  it("maps NULL both ways without inventing a row", () => {
    expect(toScenarioColumn(BASE_SCENARIO_ID)).toBeNull();
    expect(toScenarioColumn(undefined)).toBeNull();
    expect(toScenarioColumn(null)).toBeNull();
    expect(toScenarioColumn("")).toBeNull();
    expect(toScenarioColumn("scenario_1")).toBe("scenario_1");

    expect(toScenarioId(null)).toBe(BASE_SCENARIO_ID);
    expect(toScenarioId("scenario_1")).toBe("scenario_1");
  });

  /**
   * The back-compat requirement in one test: every assumption that existed
   * before this feature carries scenarioId = null, and asking for the base
   * scenario — or asking for nothing at all — returns exactly those.
   */
  it("is where assumptions written before scenarios existed still live", () => {
    const legacy = [
      row({ id: "old_1", scenarioId: null, label: "Rent rise" }),
      row({ id: "old_2", scenarioId: null, label: "New laptop", kind: "ONE_OFF" }),
    ];

    expect(assumptionsInScenario(legacy, BASE_SCENARIO_ID)).toEqual(legacy);
    expect(assumptionsInScenario(legacy, undefined)).toEqual(legacy);
    expect(assumptionsInScenario(legacy, null)).toEqual(legacy);
  });

  it("leaves the pre-scenario forecast bit-for-bit unchanged", () => {
    const legacy = [row({ id: "old_1", scenarioId: null, amount: 3000 })];

    // What the workspace saw before scenarios shipped: every assumption it had.
    const before = forecast(legacy);
    // What it sees after, once a named scenario exists alongside them.
    const withNamedScenario = [
      ...legacy,
      row({ id: "new_1", scenarioId: "scenario_1", amount: 9000, label: "Hire" }),
    ];
    const after = forecast(assumptionsInScenario(withNamedScenario, BASE_SCENARIO_ID));

    expect(after.metrics).toEqual(before.metrics);
    expect(after.activeAssumptions).toBe(1);
    expect(after.horizons.m12).toEqual(before.horizons.m12);
  });
});

/* ------------------------------------------------------------------ */
/* Scenario-scoped assumptions feeding the engine                      */
/* ------------------------------------------------------------------ */

describe("scenario-scoped assumptions", () => {
  const rows = [
    row({ id: "a1", scenarioId: null, label: "Base rent rise", amount: 500 }),
    row({ id: "a2", scenarioId: "hire", label: "New hire salary", amount: 6000 }),
    row({ id: "a3", scenarioId: "hire", label: "Laptop", kind: "ONE_OFF", amount: 2000, date: new Date(Date.UTC(2026, 7, 10)), startDate: null }),
    row({ id: "a4", scenarioId: "lose_client", label: "Lost retainer", kind: "PERCENT_GROWTH", type: "INCOME", amount: null, percent: -10 }),
    row({ id: "a5", scenarioId: "hire", label: "Disabled extra", amount: 50_000, enabled: false }),
  ];

  it("hands each scenario only its own assumptions", () => {
    expect(assumptionsInScenario(rows, BASE_SCENARIO_ID).map((r) => r.id)).toEqual(["a1"]);
    expect(assumptionsInScenario(rows, "hire").map((r) => r.id)).toEqual(["a2", "a3", "a5"]);
    expect(assumptionsInScenario(rows, "lose_client").map((r) => r.id)).toEqual(["a4"]);
    expect(assumptionsInScenario(rows, "unknown")).toEqual([]);
  });

  it("counts only enabled assumptions as active, per scenario", () => {
    expect(forecast(assumptionsInScenario(rows, "hire")).activeAssumptions).toBe(2);
    expect(forecast(assumptionsInScenario(rows, BASE_SCENARIO_ID)).activeAssumptions).toBe(1);
  });

  /**
   * The engine is untouched: two scenarios differ only because different
   * assumptions were handed in. A 6,000/month hire on a business netting
   * ~2,200/month is what turns an infinite runway finite.
   */
  it("produces a different projection per scenario from one engine", () => {
    const base = forecast(assumptionsInScenario(rows, BASE_SCENARIO_ID));
    const hire = forecast(assumptionsInScenario(rows, "hire"));

    expect(base.metrics.runwayMonths).toBeNull();
    expect(hire.metrics.runwayMonths).not.toBeNull();
    expect(hire.metrics.projectedBalance90d).toBeLessThan(base.metrics.projectedBalance90d);
    // Same history, so the actuals are identical whichever scenario is on screen.
    expect(hire.currentBalance).toBe(base.currentBalance);
    expect(hire.recurringExpenses).toEqual(base.recurringExpenses);
  });

  it("keeps a scenario's assumptions out of every other scenario's forecast", () => {
    const hire = forecast(assumptionsInScenario(rows, "hire"));
    const everything = forecast(rows);
    expect(everything.metrics.projectedBalance90d).not.toBe(hire.metrics.projectedBalance90d);
  });
});

/* ------------------------------------------------------------------ */
/* Duplicate                                                           */
/* ------------------------------------------------------------------ */

describe("duplicating a scenario", () => {
  const source = [
    row({ id: "a1", scenarioId: null, label: "Rent rise", amount: 500 }),
    row({
      id: "a2",
      scenarioId: null,
      label: "Expected invoice",
      kind: "ONE_OFF",
      type: "INCOME",
      amount: 12_000,
      date: new Date(Date.UTC(2026, 7, 15)),
      startDate: null,
    }),
    row({ id: "a3", scenarioId: null, label: "Cost inflation", kind: "PERCENT_GROWTH", amount: null, percent: 5 }),
    row({ id: "a4", scenarioId: null, label: "Parked idea", amount: 800, enabled: false }),
  ];

  const copies = assumptionCopies(source, {
    workspaceId: "ws_1",
    userId: "user_2",
    scenarioId: "copy_1",
  });

  it("copies every assumption into the new scenario", () => {
    expect(copies).toHaveLength(source.length);
    expect(copies.every((copy) => copy.scenarioId === "copy_1")).toBe(true);
    expect(copies.every((copy) => copy.workspaceId === "ws_1")).toBe(true);
    expect(copies.map((copy) => copy.label)).toEqual([
      "Rent rise",
      "Expected invoice",
      "Cost inflation",
      "Parked idea",
    ]);
  });

  it("carries kind, amounts, dates and the on/off state across", () => {
    expect(copies[1]).toMatchObject({
      kind: "ONE_OFF",
      type: "INCOME",
      amount: 12_000,
      date: new Date(Date.UTC(2026, 7, 15)),
    });
    expect(copies[2]).toMatchObject({ kind: "PERCENT_GROWTH", amount: null, percent: 5 });
    // A disabled assumption stays disabled: a copy is the same plan, not a
    // reset one.
    expect(copies[3].enabled).toBe(false);
  });

  it("does not carry the source rows' identity", () => {
    for (const copy of copies) {
      expect(copy).not.toHaveProperty("id");
      expect(copy).not.toHaveProperty("createdAt");
    }
    expect(copies.every((copy) => copy.userId === "user_2")).toBe(true);
  });

  /** The real proof: a duplicate forecasts identically until something changes. */
  it("forecasts exactly like its source", () => {
    const original = forecast(assumptionsInScenario(source, BASE_SCENARIO_ID));
    const duplicated = forecast(
      copies.map((copy, index) => ({ ...copy, id: `copy_${index}` }) as AssumptionInput)
    );
    expect(duplicated.metrics).toEqual(original.metrics);
  });

  it("copies nothing when the source scenario is empty", () => {
    expect(assumptionCopies([], { workspaceId: "ws_1", userId: "u", scenarioId: "s" })).toEqual([]);
  });

  it("names each copy something the unique index will accept", () => {
    expect(nextCopyName("Base case", [])).toBe("Base case (copy)");
    expect(nextCopyName("Base case", ["Base case (copy)"])).toBe("Base case (copy 2)");
    expect(nextCopyName("Base case", ["Base case (copy)", "Base case (copy 2)"])).toBe(
      "Base case (copy 3)"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Which scenarios a request is about                                  */
/* ------------------------------------------------------------------ */

describe("resolving the scenarios on screen", () => {
  const scenarios: ScenarioSummary[] = [
    { id: BASE_SCENARIO_ID, name: "Base case", isDefault: false, assumptionCount: 1, enabledAssumptionCount: 1 },
    { id: "hire", name: "Hire in Q4", isDefault: true, assumptionCount: 2, enabledAssumptionCount: 2 },
    { id: "lose", name: "Lose top client", isDefault: false, assumptionCount: 1, enabledAssumptionCount: 0 },
    { id: "raise", name: "Raise a round", isDefault: false, assumptionCount: 0, enabledAssumptionCount: 0 },
  ];

  it("honours the request when it names a scenario that exists", () => {
    expect(resolveActiveScenarioId("lose", scenarios)).toBe("lose");
  });

  it("falls back to the workspace default, then to the base scenario", () => {
    expect(resolveActiveScenarioId(undefined, scenarios)).toBe("hire");
    // Deleting the scenario you were looking at lands you back on the default.
    expect(resolveActiveScenarioId("deleted_id", scenarios)).toBe("hire");
    const noDefault = scenarios.map((scenario) => ({ ...scenario, isDefault: false }));
    expect(resolveActiveScenarioId("deleted_id", noDefault)).toBe(BASE_SCENARIO_ID);
    expect(resolveActiveScenarioId(undefined, [])).toBe(BASE_SCENARIO_ID);
  });

  it("puts the primary scenario first and keeps the requested order", () => {
    expect(resolveComparedScenarioIds("hire", "lose,raise", scenarios)).toEqual([
      "hire",
      "lose",
      "raise",
    ]);
    expect(resolveComparedScenarioIds("hire", ["raise"], scenarios)).toEqual(["hire", "raise"]);
  });

  it("comparing against nothing is just the single-scenario view", () => {
    expect(resolveComparedScenarioIds("hire", undefined, scenarios)).toEqual(["hire"]);
    expect(resolveComparedScenarioIds("hire", "", scenarios)).toEqual(["hire"]);
    expect(resolveComparedScenarioIds("hire", ",,", scenarios)).toEqual(["hire"]);
  });

  it("drops unknown ids, duplicates and the primary repeated", () => {
    expect(resolveComparedScenarioIds("hire", "hire,lose,lose,nope", scenarios)).toEqual([
      "hire",
      "lose",
    ]);
  });

  it("never draws more than three lines, however long the URL is", () => {
    const many = resolveComparedScenarioIds("base", "hire,lose,raise", [
      ...scenarios,
      { id: "base", name: "b", isDefault: false, assumptionCount: 0, enabledAssumptionCount: 0 },
    ]);
    expect(many).toHaveLength(MAX_COMPARED_SCENARIOS);
  });

  it("gives each position on the chart a colour", () => {
    expect(scenarioColor(0)).not.toBe(scenarioColor(1));
    expect(scenarioColor(1)).not.toBe(scenarioColor(2));
    expect(scenarioColor(3)).toBe(scenarioColor(0));
  });
});

/* ------------------------------------------------------------------ */
/* The comparison itself                                               */
/* ------------------------------------------------------------------ */

describe("comparing scenarios", () => {
  const hire = row({ id: "a2", scenarioId: "hire", label: "New hire", amount: 6000 });
  const invoice = row({
    id: "a3",
    scenarioId: "cash",
    label: "Expected invoice",
    kind: "ONE_OFF",
    type: "INCOME",
    amount: 12_000,
    date: new Date(Date.UTC(2026, 7, 15)),
    startDate: null,
  });

  const compared: ComparedScenario[] = [
    { id: BASE_SCENARIO_ID, name: "Base case", forecast: forecast([]) },
    { id: "hire", name: "Hire in Q4", forecast: forecast([hire]) },
    { id: "cash", name: "Invoice lands", forecast: forecast([invoice]) },
  ];

  const deltas = scenarioDeltas(compared);

  it("makes the primary scenario the baseline", () => {
    expect(deltas[0].isPrimary).toBe(true);
    expect(deltas[0].delta30d).toBe(0);
    expect(deltas[0].delta90d).toBe(0);
    expect(deltas[0].delta12m).toBe(0);
    expect(deltas[0].runwayDeltaMonths).toBe(null);
  });

  it("reports each scenario's cash at 30, 90 and 365 days", () => {
    for (const delta of deltas) {
      const source = compared.find((entry) => entry.id === delta.id)!;
      expect(delta.balance30d).toBe(source.forecast.metrics.projectedBalance30d);
      expect(delta.balance90d).toBe(source.forecast.metrics.projectedBalance90d);
      expect(delta.balance12m).toBe(source.forecast.metrics.projectedBalance12m);
      expect(delta.runwayMonths).toBe(source.forecast.metrics.runwayMonths);
    }
  });

  it("signs the gap to the primary the way a reader expects", () => {
    const worse = deltas.find((delta) => delta.id === "hire")!;
    const better = deltas.find((delta) => delta.id === "cash")!;
    expect(worse.delta90d).toBeLessThan(0);
    expect(better.delta90d).toBeGreaterThan(0);
    expect(Math.abs(better.delta90d - 12_000)).toBeLessThan(200);
  });

  it("refuses to subtract months from an infinite runway", () => {
    // Base case never runs out; the hire scenario does. "Infinite minus eight
    // months" is not a number worth printing.
    expect(deltas.find((delta) => delta.id === "hire")!.runwayMonths).not.toBeNull();
    expect(deltas.find((delta) => delta.id === "hire")!.runwayDeltaMonths).toBeNull();
  });

  it("returns nothing to compare when there is nothing to compare", () => {
    expect(scenarioDeltas([])).toEqual([]);
  });

  it("merges the scenarios onto one date axis", () => {
    const series = buildComparisonSeries(toScenarioSeries(compared), "d90");
    const primaryPoints = compared[0].forecast.horizons.d90;

    expect(series).toHaveLength(primaryPoints.length);
    expect(series.map((point) => point.date)).toEqual(primaryPoints.map((point) => point.date));

    const projected = series.find((point) => point.actual === null)!;
    expect(typeof projected[scenarioSeriesKey(0)]).toBe("number");
    expect(typeof projected[scenarioSeriesKey(1)]).toBe("number");
    expect(typeof projected[scenarioSeriesKey(2)]).toBe("number");
    // History is history: one actual line, taken from the primary.
    expect(series[0].actual).toBe(primaryPoints[0].actual);
  });

  it("keeps the confidence band on the primary scenario only", () => {
    const series = buildComparisonSeries(toScenarioSeries(compared), "d30");
    const banded = series.filter((point) => point.band !== null);
    expect(banded.length).toBeGreaterThan(0);
    for (const point of banded) {
      expect(point.band).toEqual(
        compared[0].forecast.horizons.d30.find((entry) => entry.date === point.date)?.band
      );
    }
    // Nothing in a row carries a second band.
    expect(Object.keys(series[0]).filter((key) => key.includes("band"))).toEqual(["band"]);
  });

  it("gives a scenario missing a date an explicit null rather than a gap", () => {
    const truncated = toScenarioSeries(compared).map((entry, index) =>
      index === 0 ? entry : { ...entry, horizons: { ...entry.horizons, d30: [] } }
    );
    const series = buildComparisonSeries(truncated, "d30");
    expect(series.every((point) => point[scenarioSeriesKey(1)] === null)).toBe(true);
  });

  it("has nothing to draw without a primary scenario", () => {
    expect(buildComparisonSeries([], "d90")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Plan cap                                                            */
/* ------------------------------------------------------------------ */

describe("the per-plan scenario cap", () => {
  it("allows a create up to the limit and refuses past it", () => {
    expect(canAddScenario(0, 3)).toEqual({ allowed: true, used: 0, limit: 3 });
    expect(canAddScenario(2, 3).allowed).toBe(true);
    expect(canAddScenario(3, 3).allowed).toBe(false);
    expect(canAddScenario(4, 3).allowed).toBe(false);
  });

  it("treats null as unlimited and 0 as none", () => {
    expect(canAddScenario(99, null)).toEqual({ allowed: true, used: 99, limit: null });
    expect(canAddScenario(0, 0).allowed).toBe(false);
  });

  it("gives the paid tiers that have assumptions the scenarios to put in them", () => {
    expect(getPlan("PRO", "business").limits.maxScenarios).toBe(3);
    expect(getPlan("BUSINESS", "business").limits.maxScenarios).toBeNull();
    expect(getPlan("ENTERPRISE", "business").limits.maxScenarios).toBeNull();
    expect(getPlan("PREMIUM", "personal").limits.maxScenarios).toBe(3);
  });

  /**
   * The two limits cannot disagree: a tier that cannot write an assumption has
   * nothing to put in a scenario, so it gets none and sees a locked teaser.
   */
  it("gives no scenarios to any tier without assumptions", () => {
    for (const edition of ["business", "personal"] as const) {
      for (const planId of EDITION_PLAN_ORDER[edition]) {
        const limits = getPlan(planId, edition).limits;
        if (!limits.assumptionsEnabled) {
          expect(limits.maxScenarios).toBe(0);
        } else {
          expect(limits.maxScenarios === null || limits.maxScenarios > 0).toBe(true);
        }
      }
    }
  });

  it("never lets a plan offer more scenarios than one chart can show", () => {
    for (const edition of ["business", "personal"] as const) {
      for (const planId of EDITION_PLAN_ORDER[edition]) {
        const limit = getPlan(planId, edition).limits.maxScenarios;
        if (limit !== null) expect(limit).toBeLessThanOrEqual(10);
      }
    }
  });
});
