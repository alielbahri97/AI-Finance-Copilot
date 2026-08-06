import { describe, expect, it } from "vitest";

import {
  assetCreateSchema,
  assetUpdateSchema,
  valuationCreateSchema,
} from "@/app/api/net-worth/schemas";
import { navItemsFor } from "@/components/dashboard/nav-items";
import { EDITION_PLAN_ORDER, getPlan } from "@/lib/billing/plans";
import { computeCashPosition, type CashAccountInput } from "@/lib/finance/cash";
import {
  ASSET_KIND_LABELS,
  ASSET_KINDS,
  buildNetWorthHistory,
  computeNetWorth,
  endOfMonth,
  isLiabilityKind,
  LIABILITY_KINDS,
  monthAxis,
  monthEndCashSeries,
  monthKey,
  selectLargestAssets,
  summarizeTrend,
  valuationAsOf,
  type AssetInput,
  type AssetKind,
} from "@/lib/personal/net-worth";
import { editionAllowsPath, editionHasFeature } from "@/lib/workspace/editions";

const NOW = new Date("2026-08-05T12:00:00Z");

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function asset(overrides: Partial<AssetInput> = {}): AssetInput {
  return {
    id: "asset_1",
    name: "House",
    kind: "PROPERTY",
    currency: null,
    note: null,
    createdAt: day("2026-01-01"),
    valuations: [],
    ...overrides,
  };
}

/** `[iso, value]` pairs, deliberately unsorted at some call sites. */
function valuations(...entries: [string, number][]) {
  return entries.map(([iso, value]) => ({ asOf: day(iso), value }));
}

/* ------------------------------------------------------------------ */
/* Kinds                                                              */
/* ------------------------------------------------------------------ */

describe("asset kinds", () => {
  it("labels every kind the Prisma enum has", () => {
    for (const kind of ASSET_KINDS) {
      expect(ASSET_KIND_LABELS[kind]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(ASSET_KIND_LABELS).sort()).toEqual([...ASSET_KINDS].sort());
  });

  it("splits the kinds into what is owned and what is owed", () => {
    expect([...LIABILITY_KINDS]).toEqual(["LOAN", "MORTGAGE", "CREDIT_LINE", "OTHER_LIABILITY"]);
    for (const kind of ASSET_KINDS) {
      expect(isLiabilityKind(kind)).toBe((LIABILITY_KINDS as readonly AssetKind[]).includes(kind));
    }
    expect(isLiabilityKind("CASH")).toBe(false);
    expect(isLiabilityKind("CREDIT_LINE")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Current position                                                    */
/* ------------------------------------------------------------------ */

describe("computeNetWorth", () => {
  it("adds what is owned to cash and subtracts what is owed", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 5_000,
      assets: [
        asset({ id: "a1", valuations: valuations(["2026-07-01", 400_000]) }),
        asset({
          id: "a2",
          name: "Mortgage",
          kind: "MORTGAGE",
          valuations: valuations(["2026-07-01", 250_000]),
        }),
      ],
    });

    expect(position.assetTotal).toBe(400_000);
    expect(position.liabilityTotal).toBe(250_000);
    expect(position.cash).toBe(5_000);
    expect(position.totalAssets).toBe(405_000);
    expect(position.netWorth).toBe(155_000);
  });

  it("takes the latest valuation as the current value, whatever order it arrives in", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 0,
      assets: [
        asset({
          valuations: valuations(
            ["2026-03-01", 380_000],
            ["2026-07-01", 400_000],
            ["2026-05-01", 390_000]
          ),
        }),
      ],
    });

    const house = position.assets[0];
    expect(house.value).toBe(400_000);
    expect(house.asOf).toEqual(day("2026-07-01"));
    expect(house.previousValue).toBe(390_000);
    expect(house.change).toBe(10_000);
    expect(house.valuationCount).toBe(3);
  });

  /**
   * Two figures for the same day means the second was a correction. The loader
   * hands them over newest-entry-first, and both the sort and the carry-forward
   * scan have to keep that order rather than picking arbitrarily.
   */
  it("prefers the correction when two valuations share a date", () => {
    const sameDay = [
      { asOf: day("2026-07-01"), value: 415_000 },
      { asOf: day("2026-07-01"), value: 400_000 },
    ];
    expect(computeNetWorth({ currency: "EUR", cash: 0, assets: [asset({ valuations: sameDay })] })
      .assets[0].value).toBe(415_000);
    expect(valuationAsOf(sameDay, day("2026-12-31"))?.value).toBe(415_000);
  });

  it("counts a holding nobody has valued yet as nothing, and says so", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 100,
      assets: [asset({ name: "Car", kind: "VEHICLE" })],
    });

    expect(position.assets[0].value).toBe(0);
    expect(position.assets[0].reason).toBe("unvalued");
    expect(position.assets[0].counted).toBe(true);
    expect(position.assets[0].change).toBeNull();
    expect(position.unvaluedCount).toBe(1);
    expect(position.netWorth).toBe(100);
  });

  /**
   * The same rule `computeCashPosition` applies to a foreign bank account, and
   * for the same reason: there is no FX rate in this app, so a holding in
   * another currency is reported and never summed.
   */
  it("reports a foreign-currency holding without summing it", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 1_000,
      assets: [
        asset({ id: "a1", currency: "EUR", valuations: valuations(["2026-07-01", 10_000]) }),
        asset({
          id: "a2",
          name: "US brokerage",
          kind: "INVESTMENT",
          currency: "USD",
          valuations: valuations(["2026-07-01", 50_000]),
        }),
      ],
    });

    expect(position.assetTotal).toBe(10_000);
    expect(position.netWorth).toBe(11_000);
    expect(position.otherCurrencyCount).toBe(1);
    const foreign = position.assets.find((row) => row.id === "a2");
    expect(foreign?.counted).toBe(false);
    expect(foreign?.reason).toBe("other-currency");
    // Still reported with its own figure, so the page can show it.
    expect(foreign?.value).toBe(50_000);
  });

  it("treats a currency equal to the workspace's as the workspace's, whatever the case", () => {
    const position = computeNetWorth({
      currency: "eur",
      cash: 0,
      assets: [asset({ currency: "EUR", valuations: valuations(["2026-07-01", 100]) })],
    });
    expect(position.assetTotal).toBe(100);
    expect(position.otherCurrencyCount).toBe(0);
  });

  it("reports a negative net worth rather than clamping it", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 500,
      assets: [
        asset({
          name: "Student loan",
          kind: "LOAN",
          valuations: valuations(["2026-07-01", 22_000]),
        }),
      ],
    });
    expect(position.netWorth).toBe(-21_500);
    expect(position.liabilityTotal).toBe(22_000);
  });

  it("sorts each side by value, largest first", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 0,
      assets: [
        asset({ id: "a1", name: "Car", kind: "VEHICLE", valuations: valuations(["2026-07-01", 8_000]) }),
        asset({ id: "a2", name: "House", valuations: valuations(["2026-07-01", 400_000]) }),
        asset({ id: "a3", name: "Fund", kind: "INVESTMENT", valuations: valuations(["2026-07-01", 20_000]) }),
      ],
    });
    expect(position.assets.map((row) => row.name)).toEqual(["House", "Fund", "Car"]);
  });

  it("rounds to cents rather than accumulating float noise", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 0.1,
      assets: [
        asset({ id: "a1", valuations: valuations(["2026-07-01", 0.1]) }),
        asset({ id: "a2", name: "Other", valuations: valuations(["2026-07-01", 0.2]) }),
      ],
    });
    expect(position.assetTotal).toBe(0.3);
    expect(position.netWorth).toBe(0.4);
  });

  /**
   * Bank cash arrives through `computeCashPosition`, which is where the
   * `includeInTotals` switch and the foreign-account rule live. Net worth must
   * take that figure as given rather than re-deriving it, or the page and the
   * cash card would disagree.
   */
  it("inherits the cash rules, including an account excluded from totals", () => {
    const accounts: CashAccountInput[] = [
      {
        id: "acc_1",
        connectionId: "con_1",
        connectionLabel: "ING",
        label: "…1234",
        currency: "EUR",
        balance: 3_000,
        balanceAt: "2026-08-04T00:00:00.000Z",
        includeInTotals: true,
      },
      {
        id: "acc_2",
        connectionId: "con_1",
        connectionLabel: "ING",
        label: "…9999",
        currency: "EUR",
        balance: 10_000,
        balanceAt: "2026-08-04T00:00:00.000Z",
        includeInTotals: false,
      },
      {
        id: "acc_3",
        connectionId: "con_2",
        connectionLabel: "Revolut",
        label: "…4321",
        currency: "USD",
        balance: 7_000,
        balanceAt: "2026-08-04T00:00:00.000Z",
        includeInTotals: true,
      },
    ];

    const cash = computeCashPosition({ accounts, transactionBalance: 999, currency: "EUR" });
    expect(cash.total).toBe(3_000);

    const position = computeNetWorth({ currency: "EUR", cash: cash.total, assets: [] });
    expect(position.netWorth).toBe(3_000);
    expect(position.cash).toBe(3_000);
  });
});

/* ------------------------------------------------------------------ */
/* Month arithmetic                                                    */
/* ------------------------------------------------------------------ */

describe("month helpers", () => {
  it("keys and closes a month in UTC", () => {
    expect(monthKey(day("2026-08-05"))).toBe("2026-08");
    expect(monthKey(new Date("2026-01-31T23:30:00Z"))).toBe("2026-01");
    expect(endOfMonth("2026-02").toISOString()).toBe("2026-02-28T23:59:59.999Z");
    expect(endOfMonth("2028-02").toISOString()).toBe("2028-02-29T23:59:59.999Z");
    expect(endOfMonth("2026-12").toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("builds an axis ending in the current month", () => {
    const axis = monthAxis(NOW, 12);
    expect(axis).toHaveLength(12);
    expect(axis[0]).toBe("2025-09");
    expect(axis[11]).toBe("2026-08");
  });
});

describe("monthEndCashSeries", () => {
  it("runs the opening balance forward through each month's net", () => {
    const series = monthEndCashSeries(
      [
        { month: "2026-06", net: 500 },
        { month: "2026-07", net: -200 },
        { month: "2026-08", net: 100 },
      ],
      1_000
    );
    expect(series.map((point) => point.balance)).toEqual([1_500, 1_300, 1_400]);
  });

  /**
   * Same reasoning as `anchorBalanceHistory`: the shape is the imported flow,
   * but the banks are the authority on today's level, so the whole line shifts
   * to land on their figure instead of telling two different stories.
   */
  it("shifts the whole line to end on the banks' own total", () => {
    const series = monthEndCashSeries(
      [
        { month: "2026-07", net: 100 },
        { month: "2026-08", net: 100 },
      ],
      0,
      1_000
    );
    expect(series.map((point) => point.balance)).toEqual([900, 1_000]);
  });

  it("leaves the line alone when there is nothing to anchor to", () => {
    const months = [{ month: "2026-08", net: 50 }];
    expect(monthEndCashSeries(months, 0, null)[0].balance).toBe(50);
    expect(monthEndCashSeries([], 0, 1_000)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

describe("buildNetWorthHistory", () => {
  const cash = [
    { month: "2026-05", balance: 1_000 },
    { month: "2026-06", balance: 1_100 },
    { month: "2026-07", balance: 1_200 },
    { month: "2026-08", balance: 1_300 },
  ];

  it("carries the last known valuation forward through months without one", () => {
    const history = buildNetWorthHistory({
      currency: "EUR",
      cash,
      assets: [asset({ valuations: valuations(["2026-05-15", 400_000], ["2026-07-20", 410_000]) })],
    });

    expect(history.map((point) => point.assets)).toEqual([400_000, 400_000, 410_000, 410_000]);
    expect(history.map((point) => point.netWorth)).toEqual([401_000, 401_100, 411_200, 411_300]);
  });

  /**
   * A house bought in June must not appear to have been owned since January.
   * Before its first valuation a holding contributes nothing at all.
   */
  it("leaves a holding out of the months before its first valuation", () => {
    const history = buildNetWorthHistory({
      currency: "EUR",
      cash,
      assets: [asset({ valuations: valuations(["2026-07-01", 400_000]) })],
    });
    expect(history.map((point) => point.assets)).toEqual([0, 0, 400_000, 400_000]);
    expect(history[0].netWorth).toBe(1_000);
  });

  it("counts a valuation dated on the last day of a month in that month", () => {
    const history = buildNetWorthHistory({
      currency: "EUR",
      cash: [{ month: "2026-06", balance: 0 }],
      assets: [asset({ valuations: [{ asOf: new Date("2026-06-30T23:59:00Z"), value: 100 }] })],
    });
    expect(history[0].assets).toBe(100);
  });

  it("carries debts forward on their own side and nets them out", () => {
    const history = buildNetWorthHistory({
      currency: "EUR",
      cash,
      assets: [
        asset({ id: "a1", valuations: valuations(["2026-05-01", 400_000]) }),
        asset({
          id: "a2",
          name: "Mortgage",
          kind: "MORTGAGE",
          valuations: valuations(["2026-05-01", 250_000], ["2026-08-01", 248_000]),
        }),
      ],
    });

    expect(history.map((point) => point.liabilities)).toEqual([250_000, 250_000, 250_000, 248_000]);
    expect(history[3].netWorth).toBe(400_000 + 1_300 - 248_000);
  });

  it("keeps a foreign-currency holding out of every point", () => {
    const history = buildNetWorthHistory({
      currency: "EUR",
      cash,
      assets: [
        asset({ currency: "USD", valuations: valuations(["2026-05-01", 50_000]) }),
      ],
    });
    expect(history.every((point) => point.assets === 0)).toBe(true);
  });

  it("labels each month and follows the cash series' own axis", () => {
    const history = buildNetWorthHistory({ currency: "EUR", cash, assets: [] });
    expect(history.map((point) => point.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(history[3].label).toBe("Aug 2026");
    expect(buildNetWorthHistory({ currency: "EUR", cash: [], assets: [] })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Summarising                                                         */
/* ------------------------------------------------------------------ */

describe("summarizeTrend", () => {
  function point(month: string, netWorth: number) {
    return { month, label: month, assets: 0, liabilities: 0, cash: 0, netWorth };
  }

  it("measures the whole series and the last month", () => {
    const trend = summarizeTrend([
      point("2026-06", 10_000),
      point("2026-07", 11_000),
      point("2026-08", 12_500),
    ]);
    expect(trend.change).toBe(2_500);
    expect(trend.changePct).toBe(25);
    expect(trend.monthChange).toBe(1_500);
  });

  it("has nothing to compare with fewer than two points", () => {
    expect(summarizeTrend([point("2026-08", 100)])).toEqual({
      change: null,
      changePct: null,
      monthChange: null,
    });
    expect(summarizeTrend([])).toEqual({ change: null, changePct: null, monthChange: null });
  });

  /** "Up 400%" from a starting point of −1,000 is true and meaningless. */
  it("refuses a percentage off a zero or negative opening figure", () => {
    expect(summarizeTrend([point("2026-07", 0), point("2026-08", 500)]).changePct).toBeNull();
    expect(summarizeTrend([point("2026-07", -1_000), point("2026-08", 500)]).changePct).toBeNull();
    expect(summarizeTrend([point("2026-07", -1_000), point("2026-08", 500)]).change).toBe(1_500);
  });
});

describe("selectLargestAssets", () => {
  it("names the biggest counted holdings and nothing else", () => {
    const position = computeNetWorth({
      currency: "EUR",
      cash: 0,
      assets: [
        asset({ id: "a1", name: "House", valuations: valuations(["2026-07-01", 400_000]) }),
        asset({ id: "a2", name: "Fund", kind: "INVESTMENT", valuations: valuations(["2026-07-01", 20_000]) }),
        asset({ id: "a3", name: "Car", kind: "VEHICLE", valuations: valuations(["2026-07-01", 8_000]) }),
        asset({ id: "a4", name: "Bike", kind: "OTHER_ASSET", valuations: valuations(["2026-07-01", 900]) }),
        asset({ id: "a5", name: "Watch", kind: "OTHER_ASSET" }),
        asset({
          id: "a6",
          name: "US brokerage",
          kind: "INVESTMENT",
          currency: "USD",
          valuations: valuations(["2026-07-01", 900_000]),
        }),
      ],
    });

    const largest = selectLargestAssets(position.assets);
    expect(largest.map((row) => row.name)).toEqual(["House", "Fund", "Car"]);
    expect(selectLargestAssets(position.assets, 1).map((row) => row.name)).toEqual(["House"]);
    expect(selectLargestAssets([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

describe("net-worth request schemas", () => {
  it("accepts a holding with an opening figure", () => {
    const parsed = assetCreateSchema.parse({
      name: "  House  ",
      kind: "PROPERTY",
      value: "400000",
      asOf: "2026-07-01",
      note: "  Valued by the estate agent  ",
    });
    expect(parsed.name).toBe("House");
    expect(parsed.value).toBe(400_000);
    expect(parsed.asOf?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parsed.note).toBe("Valued by the estate agent");
  });

  it("allows a holding with no figure yet", () => {
    const parsed = assetCreateSchema.parse({ name: "Car", kind: "VEHICLE" });
    expect(parsed.value).toBeUndefined();
    expect(parsed.asOf).toBeUndefined();
  });

  it("refuses a negative amount, an unknown kind and an empty name", () => {
    expect(assetCreateSchema.safeParse({ name: "House", kind: "PROPERTY", value: -1 }).success).toBe(
      false
    );
    expect(assetCreateSchema.safeParse({ name: "House", kind: "HOUSEBOAT" }).success).toBe(false);
    expect(assetCreateSchema.safeParse({ name: "   ", kind: "PROPERTY" }).success).toBe(false);
    // Zero is fine: a paid-off loan is worth recording rather than deleting.
    expect(assetCreateSchema.safeParse({ name: "Loan", kind: "LOAN", value: 0 }).success).toBe(true);
  });

  it("normalises a currency code and rejects a typo", () => {
    expect(assetCreateSchema.parse({ name: "X", kind: "CASH", currency: "usd" }).currency).toBe(
      "USD"
    );
    expect(assetCreateSchema.safeParse({ name: "X", kind: "CASH", currency: "dollars" }).success).toBe(
      false
    );
  });

  /** Worth is appended through the valuations route, never edited in place. */
  it("does not let an update rewrite a value", () => {
    const parsed = assetUpdateSchema.parse({ name: "Home", value: 1 }) as Record<string, unknown>;
    expect(parsed.value).toBeUndefined();
    expect(parsed.name).toBe("Home");
  });

  it("requires both a figure and a date on a valuation", () => {
    expect(valuationCreateSchema.safeParse({ value: 10 }).success).toBe(false);
    expect(valuationCreateSchema.safeParse({ asOf: "2026-07-01" }).success).toBe(false);
    expect(valuationCreateSchema.parse({ value: "10.5", asOf: "2026-07-01" }).value).toBe(10.5);
  });
});

/* ------------------------------------------------------------------ */
/* Gating                                                              */
/* ------------------------------------------------------------------ */

describe("net-worth edition gating", () => {
  it("exists in Personal and not in Business", () => {
    expect(editionHasFeature("PERSONAL", "netWorth")).toBe(true);
    expect(editionHasFeature("BUSINESS", "netWorth")).toBe(false);
  });

  it("closes the route in a business workspace", () => {
    expect(editionAllowsPath("PERSONAL", "/net-worth")).toBe(true);
    expect(editionAllowsPath("BUSINESS", "/net-worth")).toBe(false);
    // A prefix collision is not a match.
    expect(editionAllowsPath("BUSINESS", "/net-worthiness")).toBe(true);
  });

  it("offers the sidebar item only to a personal workspace", () => {
    expect(navItemsFor("PERSONAL").map((item) => item.href)).toContain("/net-worth");
    expect(navItemsFor("BUSINESS").map((item) => item.href)).not.toContain("/net-worth");
  });
});

describe("net-worth plan gating", () => {
  it("includes manual holdings on Plus and Premium but not Personal Free", () => {
    expect(getPlan("FREE", "personal").limits.netWorthEnabled).toBe(false);
    expect(getPlan("PLUS", "personal").limits.netWorthEnabled).toBe(true);
    expect(getPlan("PREMIUM", "personal").limits.netWorthEnabled).toBe(true);
  });

  /**
   * The business tiers are edition-gated out entirely, so the flag stays false
   * there: nothing should ever read it, and if something does it must not open
   * a door the edition closed.
   */
  it("leaves the flag off on every business tier", () => {
    for (const planId of EDITION_PLAN_ORDER.business) {
      expect(getPlan(planId, "business").limits.netWorthEnabled).toBe(false);
    }
  });

  /** The page's upgrade hint names a real plan, so it can never say "undefined". */
  it("has a personal tier to upgrade to from Free", () => {
    const upgradeTo = EDITION_PLAN_ORDER.personal
      .map((planId) => getPlan(planId, "personal"))
      .find((plan) => plan.limits.netWorthEnabled);
    expect(upgradeTo?.id).toBe("PLUS");
  });
});
