import { describe, expect, it, vi } from "vitest";

import { getPlan, type PlanId } from "@/lib/billing/plans";
import {
  analyzeRecurringSpend,
  isInternalCategory,
  OVERLAP_MIN_VENDORS,
  withToolCategories,
  type RecurringSpendAudit,
} from "@/lib/business/recurring-spend";
import {
  buildToolCategoryPrompt,
  labelToolCategories,
  MAX_VENDORS_PER_BATCH,
  normalizeToolCategory,
  parseToolCategoryOutput,
  selectToolCategories,
} from "@/lib/business/recurring-spend-ai";
import type { AiClient } from "@/lib/ai/types";
import type { FinanceTransaction } from "@/lib/finance/recurrence";
import { annualisedCost, summarizeRecurringCharges } from "@/lib/finance/recurring-spend";
import { analyzeSubscriptions } from "@/lib/personal/subscriptions";
import { editionAllowsPath, editionHasFeature } from "@/lib/workspace/editions";

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

/** Builds an evenly spaced run of charges for one vendor, oldest first. */
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
      description: `${spec.label} invoice`,
      counterparty: spec.label,
      category: spec.category,
    });
  }
  return transactions;
}

/**
 * A small company's year: two storage tools and two project trackers (the
 * overlap the page exists for), a quarterly licence, a vendor that put its
 * price up, a tool that stopped billing, the office rent, and the founder's
 * own salary — which repeats exactly like a subscription and must not be
 * offered up as one.
 */
function buildHistory(): FinanceTransaction[] {
  return [
    ...charges({
      label: "Dropbox Business",
      category: "Software",
      amounts: [45],
      intervalDays: 30,
      count: 9,
      lastChargedDaysAgo: 5,
    }),
    ...charges({
      label: "Box Storage",
      category: "Software",
      amounts: [28],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 6,
    }),
    ...charges({
      label: "Asana",
      category: "Software",
      amounts: [60],
      intervalDays: 30,
      count: 9,
      lastChargedDaysAgo: 4,
    }),
    ...charges({
      label: "Trello Premium",
      category: "Software",
      amounts: [25],
      intervalDays: 30,
      count: 7,
      lastChargedDaysAgo: 8,
    }),
    // Billed once a quarter: the annualisation edge case.
    ...charges({
      label: "Design Licence",
      category: "Software",
      amounts: [600],
      intervalDays: 91,
      count: 4,
      lastChargedDaysAgo: 10,
    }),
    // 120 for the first half of the run, 150 for the second.
    ...charges({
      label: "Helpdesk Cloud",
      category: "Software",
      amounts: [120, 150],
      intervalDays: 30,
      count: 8,
      lastChargedDaysAgo: 7,
    }),
    // Last charged two months ago on a monthly cadence.
    ...charges({
      label: "Old Analytics",
      category: "Software",
      amounts: [80],
      intervalDays: 30,
      count: 6,
      lastChargedDaysAgo: 61,
    }),
    ...charges({
      label: "Regus Offices",
      category: "Rent",
      amounts: [900],
      intervalDays: 30,
      count: 9,
      lastChargedDaysAgo: 12,
    }),
    ...charges({
      label: "Own Salary",
      category: "Payroll",
      amounts: [3500],
      intervalDays: 30,
      count: 9,
      lastChargedDaysAgo: 3,
    }),
  ];
}

const audit = analyzeRecurringSpend(buildHistory(), NOW);

function vendor(label: string) {
  const found = audit.vendors.find((entry) => entry.label === label);
  expect(found, `expected ${label} to be detected`).toBeDefined();
  return found!;
}

/* ------------------------------------------------------------------ */
/* The extracted shared module                                         */
/* ------------------------------------------------------------------ */

/**
 * The Business audit and the Personal subscriptions page are two framings of
 * one measurement. These assertions are what stop the extraction from drifting
 * back into two implementations: the same history has to produce the same
 * numbers on both sides.
 */
describe("shared recurring-charge measurement", () => {
  const history = buildHistory();
  const summarised = summarizeRecurringCharges(history, NOW);
  const personal = analyzeSubscriptions(history, NOW);

  it("measures each charge identically for both editions", () => {
    const personalItems = [...personal.subscriptions, ...personal.bills];
    expect(summarised.length).toBe(personalItems.length);

    for (const charge of summarised) {
      const item = personalItems.find((entry) => entry.key === charge.key);
      expect(item, `${charge.label} missing from the personal analysis`).toBeDefined();
      expect(item!.monthlyAmount).toBe(charge.monthlyAmount);
      expect(item!.averageAmount).toBe(charge.averageAmount);
      expect(item!.cadence).toBe(charge.cadence);
      expect(item!.nextChargeAt).toBe(charge.nextChargeAt);
      expect(item!.lastChargedAt).toBe(charge.lastChargedAt);
      expect(item!.priceChange).toEqual(charge.priceChange);
    }
  });

  it("agrees about which charges have stopped", () => {
    const stoppedKeys = summarised.filter((charge) => charge.overdue).map((charge) => charge.key);
    expect(stoppedKeys.length).toBeGreaterThan(0);
    for (const key of stoppedKeys) {
      const item = [...personal.subscriptions, ...personal.bills].find(
        (entry) => entry.key === key
      );
      expect(item!.flags).toContain("overdue");
    }
  });

  it("leaves income out, so a salary paid in is never a recurring charge", () => {
    const withIncome: FinanceTransaction[] = [
      ...buildHistory(),
      ...charges({
        label: "Big Client",
        category: "Sales",
        amounts: [4000],
        intervalDays: 30,
        count: 9,
        lastChargedDaysAgo: 2,
      }).map((transaction) => ({ ...transaction, type: "INCOME" as const })),
    ];
    const withIncomeAudit = analyzeRecurringSpend(withIncome, NOW);
    expect(withIncomeAudit.vendors.some((entry) => entry.label === "Big Client")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Annualisation                                                       */
/* ------------------------------------------------------------------ */

describe("annualised cost", () => {
  it("annualises a monthly charge as twelve of it", () => {
    const dropbox = vendor("Dropbox Business");
    expect(dropbox.cadence).toBe("monthly");
    expect(dropbox.monthlyAmount).toBe(45);
    expect(dropbox.annualisedCost).toBe(540);
  });

  /**
   * The failure this guards against: reading a €600 quarterly invoice as a
   * monthly cost and reporting €7,200 a year. The cost is derived from the
   * cadence-normalised monthly figure, so it comes out as four invoices.
   */
  it("annualises a quarterly invoice as four of it, not twelve", () => {
    const licence = vendor("Design Licence");
    expect(licence.cadence).toBe("quarterly");
    expect(licence.averageAmount).toBe(600);
    expect(licence.annualisedCost).toBeCloseTo(2400, 0);
    expect(licence.annualisedCost).toBeLessThan(600 * 12);
  });

  it("annualises a weekly charge from its monthly equivalent", () => {
    const weekly = analyzeRecurringSpend(
      charges({
        label: "Cleaning Service",
        category: "Office",
        amounts: [50],
        intervalDays: 7,
        count: 12,
        lastChargedDaysAgo: 3,
      }),
      NOW
    ).vendors[0];
    // 50 a week over an average 30.44-day month, twelve months of it.
    expect(weekly.monthlyAmount).toBeCloseTo(217.43, 1);
    expect(weekly.annualisedCost).toBeCloseTo(2609.16, 0);
  });

  it("annualises every vendor and the total the same way", () => {
    for (const entry of audit.vendors) {
      expect(entry.annualisedCost).toBe(annualisedCost(entry.monthlyAmount));
    }
    expect(audit.totalAnnualisedRecurring).toBe(annualisedCost(audit.totalMonthlyRecurring));
  });

  /**
   * A yearly vendor is invisible rather than wrong: `detectRecurring` tops out
   * at a quarterly interval, so a once-a-year licence never reaches this page
   * and can never be mistaken for a twelvefold price rise.
   */
  it("does not detect a charge billed once a year at all", () => {
    const yearly = analyzeRecurringSpend(
      charges({
        label: "Annual Certificate",
        category: "Software",
        amounts: [1200],
        intervalDays: 365,
        count: 3,
        lastChargedDaysAgo: 20,
      }),
      NOW
    );
    expect(yearly.vendors).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Totals, share of spend and ordering                                 */
/* ------------------------------------------------------------------ */

describe("totals and share of spend", () => {
  it("sums only vendors that are still being charged", () => {
    const expected = audit.vendors
      .filter((entry) => !entry.overdue)
      .reduce((sum, entry) => sum + entry.monthlyAmount, 0);
    expect(audit.totalMonthlyRecurring).toBeCloseTo(expected, 2);
    expect(vendor("Old Analytics").flags).toContain("stopped");
  });

  it("states each vendor's share of average monthly expenses", () => {
    expect(audit.monthlyExpenseBase).toBeGreaterThan(0);
    for (const entry of audit.vendors) {
      const expected = (entry.monthlyAmount / audit.monthlyExpenseBase) * 100;
      expect(entry.expenseShare).toBeCloseTo(expected, 1);
    }
    expect(audit.recurringExpenseShare).toBeCloseTo(
      (audit.totalMonthlyRecurring / audit.monthlyExpenseBase) * 100,
      1
    );
  });

  it("reports no share rather than a divide-by-zero when there is no spend", () => {
    const empty = analyzeRecurringSpend([], NOW);
    expect(empty.vendors).toHaveLength(0);
    expect(empty.monthlyExpenseBase).toBe(0);
    expect(empty.recurringExpenseShare).toBe(0);
    expect(empty.totalMonthlyRecurring).toBe(0);
    expect(empty.totalAnnualisedRecurring).toBe(0);
  });

  it("sorts by monthly cost, with stopped charges last", () => {
    const active = audit.vendors.filter((entry) => !entry.overdue);
    const monthly = active.map((entry) => entry.monthlyAmount);
    expect([...monthly].sort((a, b) => b - a)).toEqual(monthly);
    expect(audit.vendors.at(-1)!.overdue).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Price creep                                                         */
/* ------------------------------------------------------------------ */

describe("price creep", () => {
  it("flags a vendor charging materially more than it first did", () => {
    const helpdesk = vendor("Helpdesk Cloud");
    expect(helpdesk.priceChange).toEqual({ from: 120, to: 150, percent: 25 });
    expect(helpdesk.flags).toContain("price_creep");
  });

  it("does not flag a vendor whose price is unchanged", () => {
    expect(vendor("Dropbox Business").priceChange).toBeNull();
    expect(vendor("Dropbox Business").flags).toEqual([]);
  });

  it("does not call a price cut creep", () => {
    const cheaper = analyzeRecurringSpend(
      charges({
        label: "Renegotiated Host",
        category: "Software",
        amounts: [200, 150],
        intervalDays: 30,
        count: 8,
        lastChargedDaysAgo: 5,
      }),
      NOW
    ).vendors[0];
    expect(cheaper.priceChange).not.toBeNull();
    expect(cheaper.flags).not.toContain("price_creep");
  });
});

/* ------------------------------------------------------------------ */
/* Payroll and internal transfers                                      */
/* ------------------------------------------------------------------ */

describe("what is not a vendor", () => {
  it("leaves the founder's own salary off the vendor list", () => {
    expect(audit.vendors.some((entry) => entry.label === "Own Salary")).toBe(false);
  });

  it("still counts payroll towards total spend, so shares are not flattered", () => {
    const withoutPayroll = analyzeRecurringSpend(
      buildHistory().filter((transaction) => transaction.category !== "Payroll"),
      NOW
    );
    expect(withoutPayroll.monthlyExpenseBase).toBeLessThan(audit.monthlyExpenseBase);
    expect(withoutPayroll.recurringExpenseShare).toBeGreaterThan(audit.recurringExpenseShare);
  });

  it("keeps rent, which is a vendor a company can renegotiate", () => {
    expect(vendor("Regus Offices").monthlyAmount).toBe(900);
  });

  it("matches internal category names case-insensitively", () => {
    expect(isInternalCategory("Payroll")).toBe(true);
    expect(isInternalCategory(" salaries ")).toBe(true);
    expect(isInternalCategory("VAT")).toBe(true);
    expect(isInternalCategory("Internal transfer")).toBe(true);
    expect(isInternalCategory("Software")).toBe(false);
    expect(isInternalCategory("Rent")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Overlap candidates (AI labels)                                      */
/* ------------------------------------------------------------------ */

/** An AI client whose reply is scripted per request. */
function fakeAi(replies: string[]): AiClient & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    provider: "groq",
    model: "test-model",
    visionModel: null,
    async chat(messages) {
      const last = messages[messages.length - 1];
      calls.push(typeof last.content === "string" ? last.content : "");
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return reply;
    },
    async *chatStream() {
      throw new Error("not used");
    },
  };
}

function labellableVendors(source: RecurringSpendAudit = audit) {
  return source.vendors
    .filter((entry) => !entry.overdue)
    .map((entry) => ({ key: entry.key, label: entry.label, category: entry.category }));
}

describe("overlap candidates", () => {
  const vendors = labellableVendors();

  function labelsFor(pairs: Record<string, string>): string {
    const labels = vendors.flatMap((entry, index) =>
      pairs[entry.label] ? [{ index, category: pairs[entry.label] }] : []
    );
    return JSON.stringify({ labels });
  }

  const reply = labelsFor({
    "Dropbox Business": "cloud storage",
    "Box Storage": "cloud storage",
    Asana: "project management",
    "Trello Premium": "project management",
    "Helpdesk Cloud": "customer support",
    "Design Licence": "design software",
    "Regus Offices": "office rent",
  });

  it("flags every vendor in a category with two or more of them", async () => {
    const ai = fakeAi([reply]);
    const labelled = withToolCategories(audit, await labelToolCategories(ai, vendors));

    const categories = labelled.overlapGroups.map((group) => group.toolCategory).sort();
    expect(categories).toEqual(["cloud storage", "project management"]);

    const storage = labelled.overlapGroups.find(
      (group) => group.toolCategory === "cloud storage"
    )!;
    expect(storage.vendorLabels.sort()).toEqual(["Box Storage", "Dropbox Business"]);
    expect(storage.monthlyAmount).toBe(73);

    for (const label of ["Dropbox Business", "Box Storage", "Asana", "Trello Premium"]) {
      const entry = labelled.vendors.find((item) => item.label === label)!;
      expect(entry.flags, `${label} should be flagged as an overlap`).toContain("overlap");
    }
    // A category of one is the healthy case and says nothing.
    expect(labelled.vendors.find((item) => item.label === "Helpdesk Cloud")!.flags).not.toContain(
      "overlap"
    );
    expect(labelled.flaggedCount).toBeGreaterThan(audit.flaggedCount);
  });

  it("sorts the groups by what they cost together", () => {
    const groups = withToolCategories(
      audit,
      new Map([
        ["EXPENSE:dropbox business", "cloud storage"],
        ["EXPENSE:box storage", "cloud storage"],
        ["EXPENSE:asana", "project management"],
        ["EXPENSE:trello premium", "project management"],
      ])
    ).overlapGroups;
    expect(groups.map((group) => group.toolCategory)).toEqual([
      "project management",
      "cloud storage",
    ]);
  });

  it("says nothing about overlap when there is no AI to ask", () => {
    const unlabelled = withToolCategories(audit, new Map());
    expect(unlabelled).toEqual(audit);
    expect(unlabelled.overlapGroups).toHaveLength(0);
    expect(unlabelled.vendors.every((entry) => entry.toolCategory === null)).toBe(true);
  });

  it("never lets a label change a number", async () => {
    const ai = fakeAi([reply]);
    const labelled = withToolCategories(audit, await labelToolCategories(ai, vendors));
    expect(labelled.totalMonthlyRecurring).toBe(audit.totalMonthlyRecurring);
    expect(labelled.totalAnnualisedRecurring).toBe(audit.totalAnnualisedRecurring);
    expect(labelled.monthlyExpenseBase).toBe(audit.monthlyExpenseBase);
    for (const entry of labelled.vendors) {
      const original = audit.vendors.find((item) => item.key === entry.key)!;
      expect(entry.monthlyAmount).toBe(original.monthlyAmount);
      expect(entry.annualisedCost).toBe(original.annualisedCost);
    }
  });

  it("does not send amounts to the model", () => {
    const prompt = buildToolCategoryPrompt(vendors);
    expect(prompt).toContain("Dropbox Business");
    expect(prompt).not.toContain("45");
    expect(prompt).not.toContain("600");
  });

  it("ignores a stopped charge, which cannot be a duplicate of anything", async () => {
    const withStopped = [
      ...vendors,
      { key: "EXPENSE:old analytics", label: "Old Analytics", category: "Software" },
    ];
    // Every vendor in one category, so only the stopped-charge rule can keep
    // "Old Analytics" out of the group.
    const ai = fakeAi([
      JSON.stringify({
        labels: withStopped.map((_entry, index) => ({ index, category: "analytics" })),
      }),
    ]);
    const labelled = withToolCategories(audit, await labelToolCategories(ai, withStopped));
    const stopped = labelled.vendors.find((entry) => entry.label === "Old Analytics")!;
    expect(stopped.flags).toContain("stopped");
    expect(stopped.flags).not.toContain("overlap");
    for (const group of labelled.overlapGroups) {
      expect(group.vendorLabels).not.toContain("Old Analytics");
    }
  });
});

describe("AI labelling discipline", () => {
  const batch = [
    { key: "a", label: "Dropbox Business", category: "Software" },
    { key: "b", label: "Box Storage", category: "Software" },
  ];

  it("accepts the documented shape, a bare array and the usual synonyms", () => {
    for (const raw of [
      '{"labels":[{"index":0,"category":"cloud storage"}]}',
      '[{"index":0,"category":"cloud storage"}]',
      '{"categories":[{"index":0,"category":"cloud storage"}]}',
      'Sure!\n```json\n{"labels":[{"index":0,"category":"cloud storage"},]}\n```',
    ]) {
      const parsed = parseToolCategoryOutput(raw);
      expect(parsed.ok, raw).toBe(true);
      expect(parsed.ok && parsed.labels[0].category).toBe("cloud storage");
    }
  });

  it("reports unusable output instead of throwing", () => {
    expect(parseToolCategoryOutput("I cannot help with that.").ok).toBe(false);
    expect(parseToolCategoryOutput('{"labels":[{"index":0}]}').ok).toBe(false);
    expect(parseToolCategoryOutput("{oh dear").ok).toBe(false);
  });

  it("normalises a label so the same job groups together", () => {
    expect(normalizeToolCategory("Cloud Storage!")).toBe("cloud storage");
    expect(normalizeToolCategory("  PROJECT   management  ")).toBe("project management");
    expect(normalizeToolCategory("accounting (bookkeeping)")).toBe("accounting bookkeeping");
  });

  it("drops an index it never sent and a category echoing the vendor's name", () => {
    const selected = selectToolCategories(
      [
        { index: 0, category: "cloud storage" },
        { index: 1, category: "Box Storage" },
        { index: 9, category: "invented" },
      ],
      batch
    );
    expect([...selected]).toEqual([["a", "cloud storage"]]);
  });

  it("keeps the first label when the model answers twice for one vendor", () => {
    const selected = selectToolCategories(
      [
        { index: 0, category: "cloud storage" },
        { index: 0, category: "file sync" },
      ],
      batch
    );
    expect(selected.get("a")).toBe("cloud storage");
  });

  it("batches long vendor lists", async () => {
    const many = Array.from({ length: MAX_VENDORS_PER_BATCH + 5 }, (_, index) => ({
      key: `k${index}`,
      label: `Vendor ${index}`,
      category: "Software",
    }));
    const ai = fakeAi(['{"labels":[{"index":0,"category":"cloud storage"}]}']);
    await labelToolCategories(ai, many);
    expect(ai.calls).toHaveLength(2);
    const last = MAX_VENDORS_PER_BATCH - 1;
    expect(ai.calls[0]).toContain(`${last}. "Vendor ${last}"`);
    expect(ai.calls[1]).toContain(`0. "Vendor ${MAX_VENDORS_PER_BATCH}"`);
  });

  it("degrades to no labels when the provider fails", async () => {
    const failing: AiClient = {
      provider: "openai",
      model: "test-model",
      visionModel: null,
      chat: vi.fn().mockRejectedValue(new Error("upstream is down")),
      async *chatStream() {
        throw new Error("not used");
      },
    };
    const labels = await labelToolCategories(failing, labellableVendors());
    expect(labels.size).toBe(0);
    expect(withToolCategories(audit, labels)).toEqual(audit);
  });
});

/* ------------------------------------------------------------------ */
/* Edition and plan gating                                             */
/* ------------------------------------------------------------------ */

describe("recurring-spend gating", () => {
  it("exists in the Business edition only", () => {
    expect(editionHasFeature("BUSINESS", "recurringSpend")).toBe(true);
    expect(editionHasFeature("PERSONAL", "recurringSpend")).toBe(false);
    expect(editionAllowsPath("BUSINESS", "/recurring-spend")).toBe(true);
    expect(editionAllowsPath("PERSONAL", "/recurring-spend")).toBe(false);
  });

  it("teases Business Free and unlocks every paid Business tier", () => {
    expect(getPlan("FREE", "business").limits.recurringSpendEnabled).toBe(false);
    for (const id of ["PRO", "BUSINESS", "ENTERPRISE"] as PlanId[]) {
      expect(getPlan(id, "business").limits.recurringSpendEnabled, id).toBe(true);
    }
  });

  it("is off on every personal tier, which the edition gate already blocks", () => {
    for (const id of ["FREE", "PLUS", "PREMIUM"] as PlanId[]) {
      expect(getPlan(id, "personal").limits.recurringSpendEnabled, id).toBe(false);
    }
  });

  it("does not borrow the personal subscription-insights flag", () => {
    // The two are independent on purpose: a Business tier must not gain
    // subscription insights by unlocking this page, or vice versa.
    expect(getPlan("PRO", "business").limits.subscriptionInsightsEnabled).toBe(false);
    expect(getPlan("PLUS", "personal").limits.subscriptionInsightsEnabled).toBe(true);
    expect(getPlan("PLUS", "personal").limits.recurringSpendEnabled).toBe(false);
  });
});

describe("overlap threshold", () => {
  it("takes two vendors to make a duplicate", () => {
    expect(OVERLAP_MIN_VENDORS).toBe(2);
    const single = withToolCategories(
      audit,
      new Map([["EXPENSE:dropbox business", "cloud storage"]])
    );
    expect(single.overlapGroups).toHaveLength(0);
    expect(single.vendors.find((entry) => entry.label === "Dropbox Business")!.toolCategory).toBe(
      "cloud storage"
    );
  });
});
