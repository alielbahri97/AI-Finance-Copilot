import { describe, expect, it } from "vitest";

import type { Subscription } from "@/generated/prisma/client";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { buildSuggestedQuestions } from "@/lib/ai/suggestions";
import { resolvePlanId } from "@/lib/billing/entitlements";
import {
  canAddBankConnection,
  checkoutPlans,
  formatPlanPrice,
  getPlan,
  getPlanPriceId,
  planBelongsToEdition,
  planFromPriceId,
  planOrder,
  trialPlan,
  type PlanId,
} from "@/lib/billing/plans";
import { EDITIONS, editionBranding } from "@/lib/branding";
import { computeForecast } from "@/lib/finance/forecast";
import { navItemsFor } from "@/components/dashboard/nav-items";
import {
  ALL_EDITION_FEATURES,
  applyEditionPermissions,
  defaultWorkspaceName,
  DEFAULT_WORKSPACE_TYPE,
  EDITION_FEATURES,
  EDITION_METADATA_KEY,
  EDITION_PARAM,
  EDITION_PERMISSIONS,
  editionAllowsPath,
  editionForWorkspaceType,
  editionHasFeature,
  featureForPath,
  isWorkspaceTypeParam,
  parseWorkspaceType,
  WORKSPACE_TYPES,
  workspaceTypeParam,
  type EditionFeature,
  type WorkspaceType,
} from "@/lib/workspace/editions";
import { ALL_PERMISSIONS, resolvePermissions, type Permission } from "@/lib/workspace/permissions";

/* ------------------------------------------------------------------ */
/* Feature matrix                                                      */
/* ------------------------------------------------------------------ */

describe("edition feature matrix", () => {
  it("gives every declared feature to exactly one edition", () => {
    for (const feature of ALL_EDITION_FEATURES) {
      const owners = WORKSPACE_TYPES.filter((type) => editionHasFeature(type, feature));
      expect(owners, `${feature} must belong to exactly one edition`).toHaveLength(1);
    }
  });

  it("keeps the business surfaces business-only", () => {
    const businessOnly: EditionFeature[] = ["invoices", "counterparties", "team", "accounting"];
    for (const feature of businessOnly) {
      expect(editionHasFeature("BUSINESS", feature)).toBe(true);
      expect(editionHasFeature("PERSONAL", feature)).toBe(false);
    }
  });

  it("keeps the personal surfaces personal-only", () => {
    const personalOnly: EditionFeature[] = ["budgets", "goals", "subscriptions"];
    for (const feature of personalOnly) {
      expect(editionHasFeature("PERSONAL", feature)).toBe(true);
      expect(editionHasFeature("BUSINESS", feature)).toBe(false);
    }
  });

  it("leaves the Business edition exactly as it shipped", () => {
    expect([...EDITION_FEATURES.BUSINESS].sort()).toEqual([
      "accounting",
      "counterparties",
      "invoices",
      "team",
    ]);
    expect(EDITION_PERMISSIONS.BUSINESS).toEqual(ALL_PERMISSIONS);
  });
});

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

describe("edition permissions", () => {
  it("removes invoice and member management from a personal workspace", () => {
    const personal = new Set(EDITION_PERMISSIONS.PERSONAL);
    for (const removed of ["view_invoices", "edit_invoices", "manage_members"] as Permission[]) {
      expect(personal.has(removed), `${removed} must not exist in Personal`).toBe(false);
    }
  });

  it("keeps every shared permission in both editions", () => {
    const shared: Permission[] = [
      "view_transactions",
      "edit_transactions",
      "view_reports",
      "export_data",
      "use_copilot",
      "manage_forecast",
      "manage_integrations",
      "view_billing",
      "manage_settings",
    ];
    for (const permission of shared) {
      expect(EDITION_PERMISSIONS.BUSINESS).toContain(permission);
      expect(EDITION_PERMISSIONS.PERSONAL).toContain(permission);
    }
  });

  /**
   * The load-bearing guarantee: the owner of a Personal workspace — who has
   * every permission the role system can grant — still cannot touch invoices
   * or members, because the narrowing happens in the workspace context before
   * any route sees the set.
   */
  it("narrows an owner's permissions so requireWorkspace already refuses", () => {
    const owner = resolvePermissions("OWNER");
    expect(owner.has("edit_invoices")).toBe(true);

    const personal = applyEditionPermissions("PERSONAL", owner);
    expect(personal.has("edit_invoices")).toBe(false);
    expect(personal.has("view_invoices")).toBe(false);
    expect(personal.has("manage_members")).toBe(false);
    expect(personal.has("edit_transactions")).toBe(true);
    expect(personal.has("use_copilot")).toBe(true);

    expect([...applyEditionPermissions("BUSINESS", owner)].sort()).toEqual([...owner].sort());
  });

  it("never grants a permission the member did not already have", () => {
    const viewer = resolvePermissions("VIEWER");
    const narrowed = applyEditionPermissions("PERSONAL", viewer);
    for (const permission of narrowed) {
      expect(viewer.has(permission)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Route guards                                                        */
/* ------------------------------------------------------------------ */

describe("edition route guards", () => {
  const SHARED_PATHS = [
    "/dashboard",
    "/transactions",
    "/transactions/abc",
    "/import",
    "/categories",
    "/forecast",
    "/reports",
    "/copilot",
    "/integrations",
    "/billing",
    "/profile",
    "/settings",
    "/help",
  ];

  it("lets both editions open every shared path", () => {
    for (const path of SHARED_PATHS) {
      expect(featureForPath(path), `${path} must not be owned by a feature`).toBeNull();
      for (const type of WORKSPACE_TYPES) {
        expect(editionAllowsPath(type, path), `${type} blocked on ${path}`).toBe(true);
      }
    }
  });

  it("blocks the invoice routes in a personal workspace", () => {
    for (const path of ["/invoices", "/invoices/inv_1", "/invoices/new"]) {
      expect(editionAllowsPath("BUSINESS", path)).toBe(true);
      expect(editionAllowsPath("PERSONAL", path)).toBe(false);
    }
  });

  it("blocks the personal routes in a business workspace", () => {
    for (const path of ["/budgets", "/goals", "/goals/g_1", "/subscriptions"]) {
      expect(editionAllowsPath("PERSONAL", path)).toBe(true);
      expect(editionAllowsPath("BUSINESS", path)).toBe(false);
    }
  });

  it("does not treat a prefix collision as a match", () => {
    // "/goals" must not gate "/goalscraper" or "/budgeting".
    expect(featureForPath("/goalscraper")).toBeNull();
    expect(featureForPath("/budgeting")).toBeNull();
    expect(editionAllowsPath("BUSINESS", "/goalscraper")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

describe("edition navigation", () => {
  function hrefs(type: WorkspaceType): string[] {
    return navItemsFor(type, false).map((item) => item.href);
  }

  it("agrees with the server-side guard on every item it shows", () => {
    for (const type of WORKSPACE_TYPES) {
      for (const href of hrefs(type)) {
        expect(editionAllowsPath(type, href), `${type} nav offers blocked ${href}`).toBe(true);
      }
    }
  });

  it("shows invoices only to business and the personal pages only to personal", () => {
    expect(hrefs("BUSINESS")).toContain("/invoices");
    expect(hrefs("BUSINESS")).not.toContain("/budgets");
    expect(hrefs("PERSONAL")).not.toContain("/invoices");
    expect(hrefs("PERSONAL")).toEqual(
      expect.arrayContaining(["/budgets", "/goals", "/subscriptions"])
    );
  });

  it("keeps the shared pages in both sidebars", () => {
    for (const href of ["/dashboard", "/transactions", "/forecast", "/reports", "/copilot"]) {
      expect(hrefs("BUSINESS")).toContain(href);
      expect(hrefs("PERSONAL")).toContain(href);
    }
  });

  it("adds the admin item only for admins", () => {
    expect(navItemsFor("PERSONAL", true).map((item) => item.href)).toContain("/admin");
    expect(navItemsFor("PERSONAL", false).map((item) => item.href)).not.toContain("/admin");
  });
});

/* ------------------------------------------------------------------ */
/* Signup → workspace type                                             */
/* ------------------------------------------------------------------ */

describe("signup edition flow", () => {
  it("defaults to Business, so existing accounts are unaffected", () => {
    expect(DEFAULT_WORKSPACE_TYPE).toBe("BUSINESS");
    for (const raw of [undefined, null, "", "  ", "company", "personal-finance", "Personal"]) {
      expect(parseWorkspaceType(raw)).toBe("BUSINESS");
    }
  });

  it("reads the landing page's choice", () => {
    expect(EDITION_PARAM).toBe("for");
    expect(parseWorkspaceType("personal")).toBe("PERSONAL");
    expect(parseWorkspaceType("business")).toBe("BUSINESS");
    expect(parseWorkspaceType(" personal ")).toBe("PERSONAL");
  });

  it("only reports an explicit, recognised choice", () => {
    expect(isWorkspaceTypeParam("personal")).toBe(true);
    expect(isWorkspaceTypeParam("business")).toBe(true);
    expect(isWorkspaceTypeParam("nonsense")).toBe(false);
    expect(isWorkspaceTypeParam(undefined)).toBe(false);
  });

  /**
   * The choice survives `/signup?for=personal` → Supabase user metadata →
   * email confirmation → first login. Both hops go through the same parser, so
   * the stored enum spelling has to read back as itself.
   */
  it("round-trips through the query param and the stored metadata", () => {
    for (const type of WORKSPACE_TYPES) {
      expect(parseWorkspaceType(workspaceTypeParam(type))).toBe(type);
      const metadata = { [EDITION_METADATA_KEY]: workspaceTypeParam(type) };
      expect(parseWorkspaceType(metadata[EDITION_METADATA_KEY])).toBe(type);
      // A workspace created before the param existed stored the enum itself.
      expect(parseWorkspaceType(type)).toBe(type);
    }
  });

  it("names a new workspace per edition", () => {
    expect(defaultWorkspaceName("PERSONAL", "Ada Lovelace", "ada@example.com")).toBe("Personal");
    expect(defaultWorkspaceName("BUSINESS", "Ada Lovelace", "ada@example.com")).toBe(
      "Ada Lovelace"
    );
    expect(defaultWorkspaceName("BUSINESS", null, "ada@example.com")).toBe("ada");
    expect(defaultWorkspaceName("BUSINESS", "   ", null)).toBe("My workspace");
  });

  it("maps a workspace type to its branding edition", () => {
    expect(editionForWorkspaceType("PERSONAL")).toBe("personal");
    expect(editionForWorkspaceType("BUSINESS")).toBe("business");
    expect(editionBranding(editionForWorkspaceType("PERSONAL")).name).toBe("Ballast Personal");
    expect(editionBranding(editionForWorkspaceType("BUSINESS")).name).toBe("Ballast Business");
  });

  it("offers both editions on the landing page with distinct copy", () => {
    expect(EDITIONS.business.choiceLabel).not.toBe(EDITIONS.personal.choiceLabel);
    for (const edition of ["business", "personal"] as const) {
      const branding = EDITIONS[edition];
      expect(branding.choiceLabel.length).toBeGreaterThan(0);
      expect(branding.highlights.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Plans per edition                                                   */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-07-27T10:00:00Z");

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    workspaceId: "ws-user_1",
    userId: "user_1",
    plan: "FREE",
    status: "ACTIVE",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("plan resolution per edition", () => {
  it("sells the tiers the pricing page promises", () => {
    expect(planOrder("business")).toEqual(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]);
    expect(planOrder("personal")).toEqual(["FREE", "PLUS", "PREMIUM"]);
    expect(checkoutPlans("business")).toEqual(["PRO", "BUSINESS"]);
    expect(checkoutPlans("personal")).toEqual(["PLUS", "PREMIUM"]);
  });

  it("prices the personal tiers at €0 / €4.99 / €8.99", () => {
    expect(formatPlanPrice(getPlan("FREE", "personal"))).toBe("Free");
    expect(formatPlanPrice(getPlan("PLUS", "personal"))).toBe("€4.99");
    expect(formatPlanPrice(getPlan("PREMIUM", "personal"))).toBe("€8.99");
    // Business pricing is untouched, and Enterprise stays contact-sales.
    expect(formatPlanPrice(getPlan("PRO", "business"))).toBe("€19");
    expect(formatPlanPrice(getPlan("BUSINESS", "business"))).toBe("€49");
    expect(formatPlanPrice(getPlan("ENTERPRISE", "business"))).toBeNull();
  });

  it("resolves FREE differently in each edition", () => {
    const personalFree = getPlan("FREE", "personal").limits;
    const businessFree = getPlan("FREE", "business").limits;

    expect(personalFree.bankConnections).toBe(1);
    expect(personalFree.integrationsEnabled).toBe(true);
    expect(personalFree.aiMessagesPerMonth).toBe(50);
    expect(personalFree.invoiceExtractionsPerMonth).toBe(0);

    expect(businessFree.bankConnections).toBe(0);
    expect(businessFree.integrationsEnabled).toBe(false);
    expect(businessFree.invoiceExtractionsPerMonth).toBe(5);
  });

  it("unlocks banks, goals and subscription insights on Plus", () => {
    const free = getPlan("FREE", "personal").limits;
    const plus = getPlan("PLUS", "personal").limits;
    const premium = getPlan("PREMIUM", "personal").limits;

    expect(free.goalsEnabled).toBe(false);
    expect(free.subscriptionInsightsEnabled).toBe(false);
    expect(free.exportsEnabled).toBe(false);

    expect(plus.bankConnections).toBeNull();
    expect(plus.aiMessagesPerMonth).toBe(500);
    expect(plus.goalsEnabled).toBe(true);
    expect(plus.subscriptionInsightsEnabled).toBe(true);
    expect(plus.exportsEnabled).toBe(true);
    expect(plus.assumptionsEnabled).toBe(false);

    expect(premium.aiMessagesPerMonth).toBeNull();
    expect(premium.assumptionsEnabled).toBe(true);
    expect(premium.goalsEnabled).toBe(true);
  });

  it("keeps the business limits unchanged", () => {
    expect(getPlan("PRO", "business").limits.aiMessagesPerMonth).toBe(500);
    expect(getPlan("PRO", "business").limits.integrationsEnabled).toBe(false);
    expect(getPlan("BUSINESS", "business").limits.integrationsEnabled).toBe(true);
    expect(getPlan("BUSINESS", "business").limits.seats).toBe(5);
    expect(getPlan("ENTERPRISE", "business").limits.aiMessagesPerMonth).toBeNull();
  });

  it("knows which tier belongs to which edition", () => {
    expect(planBelongsToEdition("PLUS", "personal")).toBe(true);
    expect(planBelongsToEdition("PLUS", "business")).toBe(false);
    expect(planBelongsToEdition("ENTERPRISE", "business")).toBe(true);
    expect(planBelongsToEdition("ENTERPRISE", "personal")).toBe(false);
    // FREE is sold by both, with different limits.
    expect(planBelongsToEdition("FREE", "business")).toBe(true);
    expect(planBelongsToEdition("FREE", "personal")).toBe(true);
  });

  it("grants the edition's middle tier during the card-free trial", () => {
    expect(trialPlan("business")).toBe("PRO");
    expect(trialPlan("personal")).toBe("PLUS");

    const trialing = subscription({ trialEndsAt: new Date("2026-08-05T00:00:00Z") });
    expect(resolvePlanId(trialing, "business", NOW)).toEqual({ planId: "PRO", isTrial: true });
    expect(resolvePlanId(trialing, "personal", NOW)).toEqual({ planId: "PLUS", isTrial: true });
  });

  it("falls back to Free in both editions once the trial has lapsed", () => {
    const lapsed = subscription({ trialEndsAt: new Date("2026-07-01T00:00:00Z") });
    for (const edition of ["business", "personal"] as const) {
      expect(resolvePlanId(lapsed, edition, NOW)).toEqual({ planId: "FREE", isTrial: false });
    }
  });

  it("honours a paid plan as stored, whatever the edition", () => {
    const paid = subscription({ plan: "PREMIUM", status: "ACTIVE" });
    expect(resolvePlanId(paid, "personal", NOW).planId).toBe("PREMIUM");
    // A mismatch must never cost someone entitlements they paid for.
    expect(resolvePlanId(paid, "business", NOW).planId).toBe("PREMIUM");
    expect(getPlan("PREMIUM", "business").limits.aiMessagesPerMonth).toBeNull();
  });

  it("documents a Stripe price env var for every self-serve tier", () => {
    const expected: Record<string, string> = {
      PRO: "STRIPE_PRICE_PRO",
      BUSINESS: "STRIPE_PRICE_BUSINESS",
      PLUS: "STRIPE_PRICE_PERSONAL_PLUS",
      PREMIUM: "STRIPE_PRICE_PERSONAL_PREMIUM",
    };
    for (const edition of ["business", "personal"] as const) {
      for (const id of checkoutPlans(edition)) {
        expect(getPlan(id, edition).priceEnvVar).toBe(expected[id]);
      }
    }
  });

  it("maps a Stripe price back to its tier and edition", () => {
    const previous = {
      plus: process.env.STRIPE_PRICE_PERSONAL_PLUS,
      pro: process.env.STRIPE_PRICE_PRO,
    };
    process.env.STRIPE_PRICE_PERSONAL_PLUS = "price_plus_123";
    process.env.STRIPE_PRICE_PRO = "price_pro_123";
    try {
      expect(getPlanPriceId("PLUS", "personal")).toBe("price_plus_123");
      expect(planFromPriceId("price_plus_123")).toEqual({
        planId: "PLUS",
        edition: "personal",
      });
      expect(planFromPriceId("price_pro_123")).toEqual({ planId: "PRO", edition: "business" });
      expect(planFromPriceId("price_unknown")).toBeNull();
    } finally {
      process.env.STRIPE_PRICE_PERSONAL_PLUS = previous.plus;
      process.env.STRIPE_PRICE_PRO = previous.pro;
    }
  });

  it("enforces the bank-connection quota", () => {
    expect(canAddBankConnection(0, 1)).toEqual({ allowed: true, used: 0, limit: 1 });
    expect(canAddBankConnection(1, 1)).toEqual({ allowed: false, used: 1, limit: 1 });
    expect(canAddBankConnection(12, null)).toEqual({ allowed: true, used: 12, limit: null });
    expect(canAddBankConnection(0, 0).allowed).toBe(false);
  });

  it("never offers a personal tier to a business workspace", () => {
    const personalOnly: PlanId[] = ["PLUS", "PREMIUM"];
    for (const id of personalOnly) {
      expect(planOrder("business")).not.toContain(id);
      expect(checkoutPlans("business")).not.toContain(id);
    }
    for (const id of ["PRO", "BUSINESS", "ENTERPRISE"] as PlanId[]) {
      expect(planOrder("personal")).not.toContain(id);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Edition-flavoured AI                                                */
/* ------------------------------------------------------------------ */

/**
 * A real forecast object rather than a hand-built stub, so the prompt renders
 * the same text the app would produce. Only the runway is pinned, because the
 * suggestion list keys off it.
 */
function forecastFixture() {
  const forecast = computeForecast({
    transactions: [],
    priorNet: 4200,
    assumptions: [],
    currency: "EUR",
    now: NOW,
  });
  return { ...forecast, metrics: { ...forecast.metrics, runwayMonths: 8 } };
}

function snapshot() {
  return {
    currency: "EUR",
    generatedAt: "2026-07-27T10:00:00.000Z",
    currentBalance: 4200,
    transactionCount: 240,
    months: [
      { key: "2026-05", label: "May 2026", income: 3000, expenses: 2400, net: 600, partial: false },
      { key: "2026-06", label: "Jun 2026", income: 3000, expenses: 3200, net: -200, partial: false },
      { key: "2026-07", label: "Jul 2026", income: 1500, expenses: 1200, net: 300, partial: true },
    ],
    categorySpend: [{ name: "Groceries", last3Months: 900, last12Months: 3600 }],
    topCounterparties: [{ name: "Albert Heijn", total: 640, count: 22 }],
    largestExpenses: [],
    recurring: [
      {
        key: "netflix",
        description: "Netflix",
        counterparty: "Netflix",
        category: "Subscriptions",
        amount: -12.99,
        cadence: "MONTHLY",
        occurrences: 6,
      },
    ],
    forecast: forecastFixture(),
    assumptions: [],
    unusual: [],
  } as unknown as Parameters<typeof buildSystemPrompt>[0];
}

describe("edition-flavoured copilot", () => {
  it("frames the assistant as a CFO for business and a friend for personal", () => {
    const business = buildSystemPrompt(snapshot(), "business");
    const personal = buildSystemPrompt(snapshot(), "personal");

    expect(business).toContain("part-time CFO");
    expect(personal).not.toContain("CFO");
    expect(personal).toContain("good with money");
    expect(personal).toContain("can I afford this?");
    expect(personal).toContain("where did my money go?");
  });

  it("talks about suppliers to a business and merchants to a person", () => {
    expect(buildSystemPrompt(snapshot(), "business")).toContain("suppliers and customers");
    expect(buildSystemPrompt(snapshot(), "personal")).toContain("shops, merchants and services");
  });

  it("keeps the grounding rules and the data snapshot in both", () => {
    for (const edition of ["business", "personal"] as const) {
      const prompt = buildSystemPrompt(snapshot(), edition);
      expect(prompt).toContain("Ground every claim in the DATA SNAPSHOT");
      expect(prompt).toContain("All amounts are in EUR");
      expect(prompt).toContain("## DATA SNAPSHOT");
    }
  });

  it("defaults to the business framing", () => {
    expect(buildSystemPrompt(snapshot())).toBe(buildSystemPrompt(snapshot(), "business"));
  });

  it("withholds regulated advice from the personal edition", () => {
    expect(buildSystemPrompt(snapshot(), "personal")).toContain("Do not give regulated advice");
  });
});

describe("edition-flavoured suggestions", () => {
  it("asks personal questions in a personal workspace", () => {
    const questions = buildSuggestedQuestions(snapshot(), "personal");
    expect(questions).toContain("Where did my money go this month?");
    expect(questions).toContain("Which subscriptions am I paying for?");
    expect(questions).toContain("How much do I spend on groceries?");
    expect(questions.some((question) => question.includes("afford"))).toBe(true);
    expect(questions).not.toContain("Which suppliers cost the most?");
    expect(questions.every((question) => !question.includes("runway"))).toBe(true);
  });

  it("keeps the business questions in a business workspace", () => {
    const questions = buildSuggestedQuestions(snapshot(), "business");
    expect(questions).toContain("Which suppliers cost the most?");
    expect(questions).toContain("How long is my cash runway?");
    expect(questions).not.toContain("Where did my money go this month?");
  });

  it("uses the same signals in both editions", () => {
    // June expenses jumped >15% over May, so both editions surface it.
    expect(buildSuggestedQuestions(snapshot(), "business")[0]).toContain("Jun");
    expect(buildSuggestedQuestions(snapshot(), "personal")[0]).toContain("Jun");
  });

  it("names the real counterparty and returns no duplicates", () => {
    for (const edition of ["business", "personal"] as const) {
      const questions = buildSuggestedQuestions(snapshot(), edition);
      expect(questions).toContain("How much am I spending with Albert Heijn?");
      expect(new Set(questions).size).toBe(questions.length);
    }
  });
});
