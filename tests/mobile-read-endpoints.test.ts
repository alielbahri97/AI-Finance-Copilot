import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as billingGet } from "@/app/api/billing/summary/route";
import { GET as dashboardGet } from "@/app/api/dashboard/route";
import { GET as integrationsGet } from "@/app/api/integrations/route";
import { GET as profileGet } from "@/app/api/profile/route";
import { GET as bootstrapGet } from "@/app/api/session/bootstrap/route";
import { GET as transactionsGet } from "@/app/api/transactions/route";
import { GET as workspaceGet } from "@/app/api/workspace/route";

import { resolvePlanSource } from "@/lib/api/serializers/billing";
import { getPlan } from "@/lib/billing/plans";
import { ALL_PERMISSIONS, type Permission } from "@/lib/workspace/permissions";
import { EDITION_PERMISSIONS, type WorkspaceType } from "@/lib/workspace/editions";

const guards = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  listUserWorkspaces: vi.fn(),
}));
const domain = vi.hoisted(() => ({
  getOrCreateProfile: vi.fn(),
  getDashboardData: vi.fn(),
  getEntitlements: vi.fn(),
}));
const db = vi.hoisted(() => ({
  countTransactions: vi.fn(),
  groupTransactions: vi.fn(),
  findTransactions: vi.fn(),
  findBatches: vi.fn(),
  findConnections: vi.fn(),
  findMembers: vi.fn(),
  findFirstMember: vi.fn(),
  countMembers: vi.fn(),
  countInvitations: vi.fn(),
  findSubscription: vi.fn(),
  findPersonalProfile: vi.fn(),
  findBusinessProfile: vi.fn(),
}));

/**
 * The guards and the domain lookups are partial mocks: the surrounding modules
 * export plenty these routes do not touch, and other code in the import graph
 * does. Replacing a module wholesale would break the moment something else
 * reached for one of those.
 */
vi.mock("@/lib/workspace/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/context")>()),
  requireWorkspace: guards.requireWorkspace,
  listUserWorkspaces: guards.listUserWorkspaces,
}));

vi.mock("@/lib/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data")>()),
  getOrCreateProfile: domain.getOrCreateProfile,
  getDashboardData: domain.getDashboardData,
}));

vi.mock("@/lib/billing/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlements")>()),
  getEntitlements: domain.getEntitlements,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      count: db.countTransactions,
      groupBy: db.groupTransactions,
      findMany: db.findTransactions,
    },
    importBatch: { findMany: db.findBatches },
    integrationConnection: { findMany: db.findConnections },
    workspaceMember: {
      findMany: db.findMembers,
      findFirst: db.findFirstMember,
      count: db.countMembers,
    },
    workspaceInvitation: { count: db.countInvitations },
    subscription: { findUnique: db.findSubscription },
    personalProfile: { findUnique: db.findPersonalProfile },
    businessProfile: { findUnique: db.findBusinessProfile },
  },
}));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stands in for a Prisma `Decimal`: exact `toFixed`, and a `toString` so it
 * survives the same coercions a real one does.
 */
function decimal(value: number): { toFixed(digits: number): string; toString(): string } {
  return {
    toFixed: (digits: number) => value.toFixed(digits),
    toString: () => value.toString(),
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const USER = { id: "user-1", email: "owner@example.com" };

const PROFILE = {
  id: "user-1",
  email: "owner@example.com",
  fullName: "Ada Lovelace",
  avatarUrl: null,
  currency: "EUR",
  aiProvider: "GROQ",
  isAdmin: false,
  tourCompletedAt: new Date("2026-07-01T09:00:00Z"),
  celebrationSeenAt: null,
};

interface TestContext {
  user: typeof USER;
  workspace: {
    id: string;
    name: string;
    type: WorkspaceType;
    currency: string;
    aiCategorizationEnabled: boolean;
    autoDunningEnabled: boolean;
  };
  role: string;
  memberId: string;
  permissions: Set<Permission>;
}

/** Permissions an edition can grant at all, which is what the real guard sees. */
function permissionsFor(type: WorkspaceType, granted?: Permission[]): Set<Permission> {
  const allowed = EDITION_PERMISSIONS[type];
  return new Set((granted ?? ALL_PERMISSIONS).filter((p) => allowed.includes(p)));
}

function context(overrides: Partial<TestContext> = {}): TestContext {
  return {
    user: USER,
    workspace: {
      id: "ws-1",
      name: "Acme",
      type: "BUSINESS",
      currency: "EUR",
      aiCategorizationEnabled: true,
      autoDunningEnabled: false,
    },
    role: "OWNER",
    memberId: "member-1",
    permissions: permissionsFor(overrides.workspace?.type ?? "BUSINESS"),
    ...overrides,
  };
}

/**
 * A faithful stand-in for the real guard: 401 without a context, 403 for the
 * first missing permission, and the request always arrives first.
 */
function authorize(ctx: TestContext | null): void {
  guards.requireWorkspace.mockImplementation(async (...args: unknown[]) => {
    const required = args.filter((arg): arg is Permission => typeof arg === "string");
    if (!ctx) {
      return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
    }
    for (const permission of required) {
      if (!ctx.permissions.has(permission)) {
        return {
          ok: false,
          response: jsonResponse(
            {
              error: "You don't have permission to do this in the current workspace.",
              code: "FORBIDDEN",
              permission,
            },
            403
          ),
        };
      }
    }
    return { ok: true, ctx };
  });
}

function entitlements(overrides: Record<string, unknown> = {}) {
  return {
    plan: getPlan("BUSINESS", "business"),
    planId: "BUSINESS",
    workspaceType: "BUSINESS",
    edition: "business",
    isTrial: false,
    trialEndsAt: null,
    subscriptionStatus: "ACTIVE",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    hasStripeCustomer: true,
    planSource: "STRIPE",
    hasActiveStripeSubscription: true,
    play: null,
    period: "2026-08",
    usage: {
      aiMessages: 12,
      aiCategorizations: 3,
      csvImports: 1,
      invoiceExtractions: 4,
      exports: 2,
    },
    ...overrides,
  };
}

const DASHBOARD_DATA = {
  monthIncome: 5000,
  monthExpenses: 1234.5,
  incomeChangePct: 12,
  expensesChangePct: null,
  totalBalance: 9876.54,
  cash: {
    source: "bank" as const,
    total: 9876.54,
    currency: "EUR",
    banks: [
      {
        connectionId: "conn-1",
        label: "ING",
        total: 9876.54,
        accounts: [
          {
            id: "acc-1",
            connectionId: "conn-1",
            connectionLabel: "ING",
            label: "…1234",
            currency: "EUR",
            balance: 9876.54,
            balanceAt: "2026-08-10T06:00:00.000Z",
            includeInTotals: true,
            counted: true,
            reason: "counted" as const,
          },
        ],
      },
    ],
    accounts: [
      {
        id: "acc-1",
        connectionId: "conn-1",
        connectionLabel: "ING",
        label: "…1234",
        currency: "EUR",
        balance: 9876.54,
        balanceAt: "2026-08-10T06:00:00.000Z",
        includeInTotals: true,
        counted: true,
        reason: "counted" as const,
      },
      {
        id: "acc-2",
        connectionId: "conn-1",
        connectionLabel: "ING",
        label: "…9999",
        currency: "USD",
        balance: null,
        balanceAt: null,
        includeInTotals: true,
        counted: false,
        reason: "no-balance" as const,
      },
    ],
    countedAccounts: 1,
    excludedAccounts: 1,
    hasOtherCurrency: true,
    asOf: "2026-08-10T06:00:00.000Z",
    transactionBalance: 4321,
  },
  savingsRate: 75,
  monthlySeries: [{ month: "Aug", income: 5000, expenses: 1234.5, net: 3765.5 }],
  categoryBreakdown: [{ category: "Groceries", color: "#111111", amount: 250.25 }],
  largestExpenses: [
    {
      id: "tx-9",
      type: "EXPENSE" as const,
      amount: 800,
      category: "Rent",
      categoryColor: "#222222",
      description: "Office rent",
      date: "2026-08-01T00:00:00.000Z",
    },
  ],
  balanceHistory: [{ date: "2026-08-01", balance: 4321 }],
  recentTransactions: [
    {
      id: "tx-1",
      type: "INCOME" as const,
      amount: 5000,
      category: null,
      categoryColor: null,
      description: "Invoice 42",
      date: "2026-08-05T00:00:00.000Z",
    },
  ],
  transactionCount: 2,
};

const TRANSACTION_ROW = {
  id: "tx-1",
  type: "EXPENSE" as const,
  amount: decimal(42.5),
  categoryId: "cat-1",
  category: { name: "Groceries", color: "#00ff00" },
  description: "Albert Heijn",
  counterparty: "AH 1234",
  date: new Date("2026-08-04T00:00:00.000Z"),
  createdAt: new Date("2026-08-04T10:11:12.000Z"),
  importBatchId: "batch-1",
};

const BATCH_ROW = {
  id: "batch-1",
  fileName: "june.csv",
  createdAt: new Date("2026-06-30T12:00:00.000Z"),
  _count: { transactions: 120 },
};

const CONNECTION_ROW = {
  id: "conn-1",
  provider: "gocardless",
  status: "CONNECTED" as const,
  displayName: null,
  institutionName: "ING",
  institutionLogo: "https://cdn.example/ing.png",
  metadata: {
    consentExpiresAt: "2026-11-01T00:00:00.000Z",
    rateLimitedUntil: { "acc-1": "2030-01-01T00:00:00.000Z" },
  },
  lastSyncAt: new Date("2026-08-10T05:00:00.000Z"),
  lastError: null,
  syncRuns: [{ stats: { imported: 12, skipped: 1 } }],
  bankAccounts: [
    {
      id: "acc-1",
      name: "Current account",
      mask: "…1234",
      currency: "EUR",
      lastBalance: decimal(1500.5),
      lastBalanceAt: new Date("2026-08-10T05:00:00.000Z"),
      includeInTotals: true,
    },
    {
      id: "acc-2",
      name: "Savings",
      mask: null,
      currency: "EUR",
      lastBalance: null,
      lastBalanceAt: null,
      includeInTotals: false,
    },
  ],
};

function get(path: string): Request {
  return new Request(`http://localhost${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  authorize(context());
  guards.listUserWorkspaces.mockResolvedValue([
    { id: "ws-1", name: "Acme", type: "BUSINESS", edition: "business", role: "OWNER" },
  ]);
  domain.getOrCreateProfile.mockResolvedValue(PROFILE);
  domain.getDashboardData.mockResolvedValue(DASHBOARD_DATA);
  domain.getEntitlements.mockResolvedValue(entitlements());

  db.countTransactions.mockResolvedValue(0);
  db.groupTransactions.mockResolvedValue([]);
  db.findTransactions.mockResolvedValue([]);
  db.findBatches.mockResolvedValue([]);
  db.findConnections.mockResolvedValue([]);
  db.findMembers.mockResolvedValue([]);
  db.findFirstMember.mockResolvedValue(null);
  db.countMembers.mockResolvedValue(1);
  db.countInvitations.mockResolvedValue(0);
  db.findSubscription.mockResolvedValue(null);
  db.findPersonalProfile.mockResolvedValue(null);
  db.findBusinessProfile.mockResolvedValue(null);
});

/* ------------------------------------------------------------------ */
/* Authentication and authorization, across every endpoint             */
/* ------------------------------------------------------------------ */

const ENDPOINTS: {
  name: string;
  call: () => Promise<Response>;
  permission: Permission | null;
}[] = [
  { name: "GET /api/session/bootstrap", call: () => bootstrapGet(get("/api/session/bootstrap")), permission: null },
  { name: "GET /api/dashboard", call: () => dashboardGet(get("/api/dashboard")), permission: null },
  {
    name: "GET /api/transactions",
    call: () => transactionsGet(get("/api/transactions")),
    permission: "view_transactions",
  },
  {
    name: "GET /api/integrations",
    call: () => integrationsGet(get("/api/integrations")),
    permission: "manage_integrations",
  },
  { name: "GET /api/profile", call: () => profileGet(get("/api/profile")), permission: null },
  { name: "GET /api/workspace", call: () => workspaceGet(get("/api/workspace")), permission: null },
  {
    name: "GET /api/billing/summary",
    call: () => billingGet(get("/api/billing/summary")),
    permission: "view_billing",
  },
];

describe("every mobile read endpoint refuses an anonymous caller", () => {
  for (const endpoint of ENDPOINTS) {
    it(`answers 401 for ${endpoint.name}`, async () => {
      authorize(null);
      const response = await endpoint.call();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  }
});

describe("every mobile read endpoint authorizes the request it was given", () => {
  for (const endpoint of ENDPOINTS) {
    it(`passes the request first for ${endpoint.name}`, async () => {
      await endpoint.call();

      const args = guards.requireWorkspace.mock.calls[0];
      // A Bearer client's workspace header is only readable from the request the
      // handler was called with, so it has to be the leading argument.
      expect(args[0]).toBeInstanceOf(Request);
      expect(args.slice(1)).toEqual(endpoint.permission ? [endpoint.permission] : []);
    });
  }

  for (const endpoint of ENDPOINTS.filter((entry) => entry.permission !== null)) {
    it(`answers 403 for ${endpoint.name} without ${endpoint.permission}`, async () => {
      const withheld = ALL_PERMISSIONS.filter((p) => p !== endpoint.permission);
      authorize(context({ permissions: permissionsFor("BUSINESS", [...withheld]) }));

      const response = await endpoint.call();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "You don't have permission to do this in the current workspace.",
        code: "FORBIDDEN",
        permission: endpoint.permission,
      });
    });
  }
});

/**
 * None of these seven surfaces is edition-exclusive, so none of them can answer
 * 404 WRONG_EDITION — they all exist in both editions and differ only in what
 * they contain. This asserts that positively, so a later change that hides one
 * behind `requireEditionFeature` has to come past this test.
 */
describe("edition differences are content, not a 404", () => {
  it("answers 200 in a Personal workspace on every endpoint", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );
    domain.getEntitlements.mockResolvedValue(
      entitlements({
        plan: getPlan("PLUS", "personal"),
        planId: "PLUS",
        edition: "personal",
        workspaceType: "PERSONAL",
      })
    );

    for (const endpoint of ENDPOINTS) {
      const response = await endpoint.call();
      expect(response.status, endpoint.name).toBe(200);
    }
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/session/bootstrap                                          */
/* ------------------------------------------------------------------ */

describe("the launch call", () => {
  it("returns the profile, workspaces, membership and entitlements in one answer", async () => {
    const response = await bootstrapGet(get("/api/session/bootstrap"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.profile).toEqual({
      id: "user-1",
      email: "owner@example.com",
      fullName: "Ada Lovelace",
      avatarUrl: null,
      currency: "EUR",
      aiProvider: "GROQ",
      isAdmin: false,
      tourCompletedAt: "2026-07-01T09:00:00.000Z",
      celebrationSeenAt: null,
    });
    expect(body.workspaces).toEqual([
      { id: "ws-1", name: "Acme", type: "BUSINESS", edition: "business", role: "OWNER" },
    ]);
    expect(body.workspace).toEqual({
      id: "ws-1",
      name: "Acme",
      type: "BUSINESS",
      edition: "business",
      currency: "EUR",
      aiCategorizationEnabled: true,
      autoDunningEnabled: false,
    });
    expect(body.membership.role).toBe("OWNER");
    expect(body.membership.memberId).toBe("member-1");
    // A Set does not survive JSON; the array is sorted so it is comparable.
    expect(body.membership.permissions).toEqual([...ALL_PERMISSIONS].sort());
    expect(body.entitlements).toMatchObject({
      planId: "BUSINESS",
      planName: "Business",
      edition: "business",
      period: "2026-08",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      trialEndsAt: null,
      hasStripeCustomer: true,
    });
    // Quotas and counters are numbers, not money.
    expect(body.entitlements.limits.seats).toBe(5);
    expect(body.entitlements.usage.aiMessages).toBe(12);
  });

  it("drops the edition's impossible permissions in a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );

    const body = await (await bootstrapGet(get("/api/session/bootstrap"))).json();
    expect(body.membership.permissions).not.toContain("view_invoices");
    expect(body.membership.permissions).not.toContain("manage_members");
    expect(body.workspace.edition).toBe("personal");
  });

  it("reads onboarding from the business questionnaire in a Business workspace", async () => {
    db.findBusinessProfile.mockResolvedValue({
      completedAt: new Date("2026-01-01T00:00:00Z"),
      skippedAt: null,
    });

    const body = await (await bootstrapGet(get("/api/session/bootstrap"))).json();
    expect(body.onboardingComplete).toBe(true);
    expect(db.findBusinessProfile).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { completedAt: true, skippedAt: true },
    });
    expect(db.findPersonalProfile).not.toHaveBeenCalled();
  });

  it("reads onboarding from the personal questionnaire in a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );
    // Skipped counts as done, exactly as the dashboard layout treats it.
    db.findPersonalProfile.mockResolvedValue({
      completedAt: null,
      skippedAt: new Date("2026-02-02T00:00:00Z"),
    });

    const body = await (await bootstrapGet(get("/api/session/bootstrap"))).json();
    expect(body.onboardingComplete).toBe(true);
    expect(db.findBusinessProfile).not.toHaveBeenCalled();
  });

  it("reports onboarding as outstanding when there is no questionnaire row", async () => {
    const body = await (await bootstrapGet(get("/api/session/bootstrap"))).json();
    expect(body.onboardingComplete).toBe(false);
  });

  it("answers 500 with a safe message when a lookup fails", async () => {
    domain.getEntitlements.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const response = await bootstrapGet(get("/api/session/bootstrap"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to load the session" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/dashboard                                                  */
/* ------------------------------------------------------------------ */

describe("the dashboard figures", () => {
  it("sends every amount as a decimal string and every date as UTC ISO", async () => {
    const response = await dashboardGet(get("/api/dashboard"));
    expect(response.status).toBe(200);
    const { dashboard, currency, edition } = await response.json();

    expect(currency).toBe("EUR");
    expect(edition).toBe("business");

    expect(dashboard.monthIncome).toBe("5000.00");
    expect(dashboard.monthExpenses).toBe("1234.50");
    expect(dashboard.totalBalance).toBe("9876.54");
    expect(dashboard.cash.total).toBe("9876.54");
    expect(dashboard.cash.transactionBalance).toBe("4321.00");
    expect(dashboard.cash.banks[0].total).toBe("9876.54");
    expect(dashboard.cash.banks[0].accounts[0].balance).toBe("9876.54");
    expect(dashboard.cash.accounts[1].balance).toBeNull();
    expect(dashboard.cash.asOf).toBe("2026-08-10T06:00:00.000Z");
    expect(dashboard.monthlySeries).toEqual([
      { month: "Aug", income: "5000.00", expenses: "1234.50", net: "3765.50" },
    ]);
    expect(dashboard.categoryBreakdown).toEqual([
      { category: "Groceries", color: "#111111", amount: "250.25" },
    ]);
    expect(dashboard.largestExpenses[0].amount).toBe("800.00");
    expect(dashboard.recentTransactions[0]).toEqual({
      id: "tx-1",
      type: "INCOME",
      amount: "5000.00",
      category: null,
      categoryColor: null,
      description: "Invoice 42",
      date: "2026-08-05T00:00:00.000Z",
    });
    // A day key is widened to UTC midnight so every date reads the same way.
    expect(dashboard.balanceHistory).toEqual([
      { date: "2026-08-01T00:00:00.000Z", balance: "4321.00" },
    ]);
  });

  it("keeps counts and percentages as numbers", async () => {
    const { dashboard } = await (await dashboardGet(get("/api/dashboard"))).json();

    expect(dashboard.savingsRate).toBe(75);
    expect(dashboard.incomeChangePct).toBe(12);
    expect(dashboard.expensesChangePct).toBeNull();
    expect(dashboard.transactionCount).toBe(2);
    expect(dashboard.cash.countedAccounts).toBe(1);
    expect(dashboard.cash.excludedAccounts).toBe(1);
  });

  it("reports which sections the member may see rather than refusing the page", async () => {
    authorize(
      context({
        permissions: permissionsFor("BUSINESS", ["view_transactions"]),
      })
    );

    const response = await dashboardGet(get("/api/dashboard"));
    expect(response.status).toBe(200);
    expect((await response.json()).sections).toEqual({
      transactions: true,
      invoices: false,
      reports: false,
    });
  });

  it("never claims an invoices section in a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "USD",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );

    const body = await (await dashboardGet(get("/api/dashboard"))).json();
    expect(body.sections).toEqual({ transactions: true, invoices: false, reports: true });
    expect(body.edition).toBe("personal");
  });

  it("answers 500 with a safe message when the aggregation fails", async () => {
    domain.getDashboardData.mockRejectedValue(new Error("relation does not exist"));

    const response = await dashboardGet(get("/api/dashboard"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load dashboard" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/transactions                                               */
/* ------------------------------------------------------------------ */

function whereOf(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return (mock.mock.calls[0][0] as { where: Record<string, unknown> }).where;
}

function orderByOf(): unknown {
  return (db.findTransactions.mock.calls[0][0] as { orderBy: unknown }).orderBy;
}

describe("the transactions list", () => {
  it("serializes rows, totals and batches for the client", async () => {
    db.countTransactions.mockResolvedValue(1);
    db.findTransactions.mockResolvedValue([TRANSACTION_ROW]);
    db.findBatches.mockResolvedValue([BATCH_ROW]);
    db.groupTransactions.mockResolvedValue([
      { type: "INCOME", _sum: { amount: decimal(1000) } },
      { type: "EXPENSE", _sum: { amount: decimal(42.5) } },
    ]);

    const response = await transactionsGet(get("/api/transactions"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.transactions).toEqual([
      {
        id: "tx-1",
        type: "EXPENSE",
        amount: "42.50",
        currency: "EUR",
        category: { id: "cat-1", name: "Groceries", color: "#00ff00" },
        description: "Albert Heijn",
        counterparty: "AH 1234",
        date: "2026-08-04T00:00:00.000Z",
        createdAt: "2026-08-04T10:11:12.000Z",
        importBatchId: "batch-1",
      },
    ]);
    expect(body.totals).toEqual({ income: "1000.00", expenses: "42.50", net: "957.50" });
    expect(body.batches).toEqual([
      {
        id: "batch-1",
        fileName: "june.csv",
        createdAt: "2026-06-30T12:00:00.000Z",
        transactionCount: 120,
      },
    ]);
    expect(body.currency).toBe("EUR");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.pageCount).toBe(1);
    expect(body.totalCount).toBe(1);
    expect(body.sort).toBe("date");
    expect(body.dir).toBe("desc");
  });

  it("reports a row with no category as null rather than an empty object", async () => {
    db.findTransactions.mockResolvedValue([
      { ...TRANSACTION_ROW, categoryId: null, category: null, counterparty: null },
    ]);

    const body = await (await transactionsGet(get("/api/transactions"))).json();
    expect(body.transactions[0].category).toBeNull();
    expect(body.transactions[0].counterparty).toBeNull();
  });

  it("scopes an unfiltered query to the workspace and nothing else", async () => {
    await transactionsGet(get("/api/transactions"));
    expect(whereOf(db.findTransactions)).toEqual({ workspaceId: "ws-1" });
  });

  it("searches description and counterparty case-insensitively", async () => {
    await transactionsGet(get("/api/transactions?q=%20albert%20"));
    expect(whereOf(db.findTransactions)).toEqual({
      workspaceId: "ws-1",
      OR: [
        { description: { contains: "albert", mode: "insensitive" } },
        { counterparty: { contains: "albert", mode: "insensitive" } },
      ],
    });
  });

  it("treats a type it does not recognise as no type filter", async () => {
    await transactionsGet(get("/api/transactions?type=EXPENSE"));
    expect(whereOf(db.findTransactions).type).toBe("EXPENSE");

    vi.clearAllMocks();
    authorize(context());
    db.countTransactions.mockResolvedValue(0);
    db.groupTransactions.mockResolvedValue([]);
    db.findTransactions.mockResolvedValue([]);
    db.findBatches.mockResolvedValue([]);

    await transactionsGet(get("/api/transactions?type=TRANSFER"));
    expect(whereOf(db.findTransactions)).toEqual({ workspaceId: "ws-1" });
  });

  it("maps the uncategorized bucket to a null category, not to an id", async () => {
    await transactionsGet(get("/api/transactions?category=uncategorized"));
    expect(whereOf(db.findTransactions).categoryId).toBeNull();
  });

  it("maps a category id and an import batch straight through", async () => {
    await transactionsGet(get("/api/transactions?category=cat-7&batch=batch-3"));
    expect(whereOf(db.findTransactions)).toEqual({
      workspaceId: "ws-1",
      categoryId: "cat-7",
      importBatchId: "batch-3",
    });
  });

  it("reads a date range as UTC start-of-day to UTC end-of-day", async () => {
    await transactionsGet(get("/api/transactions?from=2026-08-01&to=2026-08-31"));
    const where = whereOf(db.findTransactions) as { date: { gte: Date; lte: Date } };

    expect(where.date.gte.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(where.date.lte.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });

  it("accepts a one-sided amount range", async () => {
    await transactionsGet(get("/api/transactions?min=10.5"));
    expect(whereOf(db.findTransactions).amount).toEqual({ gte: 10.5 });
  });

  it("accepts both ends of an amount range", async () => {
    await transactionsGet(get("/api/transactions?min=10&max=100"));
    expect(whereOf(db.findTransactions).amount).toEqual({ gte: 10, lte: 100 });
  });

  it("rejects bad filter input with 400 instead of quietly ignoring it", async () => {
    const cases: [string, string][] = [
      ["from=01-08-2026", "Dates must be formatted YYYY-MM-DD"],
      ["to=nope", "Dates must be formatted YYYY-MM-DD"],
      ["min=-1", "Amount filters cannot be negative"],
      ["max=abc", "Amount filters must be numbers"],
      ["page=0", "Page starts at 1"],
      ["page=1.5", "Page must be a whole number"],
      ["size=7", "Page size must be 25, 50 or 100"],
    ];

    for (const [query, message] of cases) {
      const response = await transactionsGet(get(`/api/transactions?${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: message });
    }
    expect(db.findTransactions).not.toHaveBeenCalled();
  });

  it("rejects a sort key or direction it cannot honour", async () => {
    for (const query of ["sort=vendor", "dir=sideways"]) {
      expect((await transactionsGet(get(`/api/transactions?${query}`))).status).toBe(400);
    }
  });

  it("ignores blank params, which is what a cleared filter sends", async () => {
    const response = await transactionsGet(
      get("/api/transactions?q=&type=&category=&from=&min=&page=&size=&sort=&dir=")
    );

    expect(response.status).toBe(200);
    expect(whereOf(db.findTransactions)).toEqual({ workspaceId: "ws-1" });
    const body = await response.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("orders by date descending by default, tie-broken on creation", async () => {
    await transactionsGet(get("/api/transactions"));
    expect(orderByOf()).toEqual([{ date: "desc" }, { createdAt: "desc" }]);
  });

  it("gives each sort column its own starting direction", async () => {
    const expected: Record<string, unknown> = {
      date: [{ date: "desc" }, { createdAt: "desc" }],
      description: [{ description: "asc" }, { date: "desc" }, { createdAt: "desc" }],
      category: [{ category: { name: "asc" } }, { date: "desc" }, { createdAt: "desc" }],
      amount: [{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }],
    };

    for (const [sort, orderBy] of Object.entries(expected)) {
      db.findTransactions.mockClear();
      await transactionsGet(get(`/api/transactions?sort=${sort}`));
      expect(orderByOf(), sort).toEqual(orderBy);
    }
  });

  it("honours an explicit direction over the column's default", async () => {
    await transactionsGet(get("/api/transactions?sort=amount&dir=asc"));
    expect(orderByOf()).toEqual([{ amount: "asc" }, { date: "desc" }, { createdAt: "desc" }]);
  });

  it("leads the uncategorized bucket with the biggest amounts", async () => {
    const response = await transactionsGet(get("/api/transactions?category=uncategorized"));
    const body = await response.json();

    expect(body.sort).toBe("amount");
    expect(body.dir).toBe("desc");
    expect(orderByOf()).toEqual([{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }]);
  });

  it("still respects an explicit sort inside the uncategorized bucket", async () => {
    const body = await (
      await transactionsGet(get("/api/transactions?category=uncategorized&sort=description"))
    ).json();
    expect(body.sort).toBe("description");
    expect(body.dir).toBe("asc");
  });

  it("pages with skip and take, and reports the page count", async () => {
    db.countTransactions.mockResolvedValue(120);

    const body = await (await transactionsGet(get("/api/transactions?page=2&size=25"))).json();
    expect(body).toMatchObject({ page: 2, pageSize: 25, pageCount: 5, totalCount: 120 });

    const call = db.findTransactions.mock.calls[0][0] as { skip: number; take: number };
    expect(call.skip).toBe(25);
    expect(call.take).toBe(25);
  });

  it("clamps a page past the end onto the last page", async () => {
    db.countTransactions.mockResolvedValue(30);

    const body = await (await transactionsGet(get("/api/transactions?page=99&size=25"))).json();
    expect(body.page).toBe(2);
    expect(body.pageCount).toBe(2);
    expect((db.findTransactions.mock.calls[0][0] as { skip: number }).skip).toBe(25);
  });

  it("reports one page for an empty result rather than zero", async () => {
    db.countTransactions.mockResolvedValue(0);

    const body = await (await transactionsGet(get("/api/transactions"))).json();
    expect(body).toMatchObject({ page: 1, pageCount: 1, totalCount: 0 });
  });

  it("aggregates totals over the whole filtered set, not the page on screen", async () => {
    // One page of one small row, but the filtered set is far larger. The totals
    // must come from the aggregate, or a filtered view lies about its own size.
    db.countTransactions.mockResolvedValue(500);
    db.findTransactions.mockResolvedValue([TRANSACTION_ROW]);
    db.groupTransactions.mockResolvedValue([
      { type: "INCOME", _sum: { amount: decimal(120000) } },
      { type: "EXPENSE", _sum: { amount: decimal(80000.75) } },
    ]);

    const body = await (
      await transactionsGet(get("/api/transactions?category=cat-7&size=25"))
    ).json();

    expect(body.totals).toEqual({
      income: "120000.00",
      expenses: "80000.75",
      net: "39999.25",
    });
    expect(db.groupTransactions).toHaveBeenCalledWith({
      by: ["type"],
      where: { workspaceId: "ws-1", categoryId: "cat-7" },
      _sum: { amount: true },
    });
    // Same predicate as the page query, and no paging on the aggregate.
    expect(whereOf(db.groupTransactions)).toEqual(whereOf(db.findTransactions));
    const groupCall = db.groupTransactions.mock.calls[0][0] as Record<string, unknown>;
    expect(groupCall.skip).toBeUndefined();
    expect(groupCall.take).toBeUndefined();
  });

  it("treats a missing side of the aggregate as zero", async () => {
    db.groupTransactions.mockResolvedValue([{ type: "EXPENSE", _sum: { amount: decimal(10) } }]);

    const body = await (await transactionsGet(get("/api/transactions"))).json();
    expect(body.totals).toEqual({ income: "0.00", expenses: "10.00", net: "-10.00" });
  });

  it("lists every batch in the workspace, not just the filtered ones", async () => {
    db.findBatches.mockResolvedValue([BATCH_ROW]);

    await transactionsGet(get("/api/transactions?batch=batch-9&from=2026-01-01"));
    expect(db.findBatches).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    });
  });

  it("answers 500 with a safe message when a query fails", async () => {
    db.countTransactions.mockRejectedValue(new Error("deadlock detected on transactions"));

    const response = await transactionsGet(get("/api/transactions"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load transactions" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/integrations                                               */
/* ------------------------------------------------------------------ */

describe("the integrations grid", () => {
  it("reports the plan lock without refusing the list", async () => {
    domain.getEntitlements.mockResolvedValue(
      entitlements({ plan: getPlan("FREE", "business"), planId: "FREE" })
    );

    const response = await integrationsGet(get("/api/integrations"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.locked).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
    expect(body.bankConnectionLimit).toBe(0);
  });

  it("unlocks on a plan that includes integrations", async () => {
    const body = await (await integrationsGet(get("/api/integrations"))).json();
    expect(body.locked).toBe(false);
  });

  it("serializes a connection with money as strings and dates as UTC ISO", async () => {
    db.findConnections.mockResolvedValue([CONNECTION_ROW]);

    const body = await (await integrationsGet(get("/api/integrations"))).json();
    const card = body.providers.find((entry: { id: string }) => entry.id === "gocardless");
    expect(card).toBeDefined();
    expect(card.connections).toHaveLength(1);

    const connection = card.connections[0];
    expect(connection).toMatchObject({
      id: "conn-1",
      provider: "gocardless",
      status: "CONNECTED",
      displayName: null,
      institutionName: "ING",
      institutionLogo: "https://cdn.example/ing.png",
      title: "ING",
      lastSyncAt: "2026-08-10T05:00:00.000Z",
      lastError: null,
      accountLabel: "2 accounts",
      calendarEnabled: false,
      consentExpiresAt: "2026-11-01T00:00:00.000Z",
      rateLimitedUntil: "2030-01-01T00:00:00.000Z",
    });
    // Sync stats are counts, so they stay numbers.
    expect(connection.lastRunStats).toEqual({ imported: 12, skipped: 1 });
    expect(connection.accounts).toEqual([
      {
        id: "acc-1",
        name: "Current account",
        mask: "…1234",
        label: "…1234",
        currency: "EUR",
        lastBalance: "1500.50",
        lastBalanceAt: "2026-08-10T05:00:00.000Z",
        includeInTotals: true,
      },
      {
        id: "acc-2",
        name: "Savings",
        mask: null,
        label: "Savings",
        currency: "EUR",
        lastBalance: null,
        lastBalanceAt: null,
        includeInTotals: false,
      },
    ]);
    // Only the included account with a balance is summed.
    expect(connection.includedBalance).toBe("1500.50");
    expect(connection.balanceCurrency).toBe("EUR");
  });

  it("refuses to total accounts that disagree on a currency", async () => {
    db.findConnections.mockResolvedValue([
      {
        ...CONNECTION_ROW,
        bankAccounts: [
          { ...CONNECTION_ROW.bankAccounts[0] },
          {
            id: "acc-3",
            name: "USD",
            mask: "…5555",
            currency: "USD",
            lastBalance: decimal(10),
            lastBalanceAt: null,
            includeInTotals: true,
          },
        ],
      },
    ]);

    const body = await (await integrationsGet(get("/api/integrations"))).json();
    const card = body.providers.find((entry: { id: string }) => entry.id === "gocardless");
    expect(card.connections[0].includedBalance).toBeNull();
    expect(card.connections[0].balanceCurrency).toBeNull();
  });

  it("prefers the member's own label for the connection title", async () => {
    db.findConnections.mockResolvedValue([{ ...CONNECTION_ROW, displayName: "ING business" }]);

    const body = await (await integrationsGet(get("/api/integrations"))).json();
    const card = body.providers.find((entry: { id: string }) => entry.id === "gocardless");
    expect(card.connections[0].title).toBe("ING business");
  });

  it("names the missing encryption key so setup is diagnosable", async () => {
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      const body = await (await integrationsGet(get("/api/integrations"))).json();
      expect(body.encryptionConfigured).toBe(false);
      for (const provider of body.providers) {
        expect(provider.configured).toBe(false);
        expect(provider.missingEnvVars).toContain("INTEGRATION_ENCRYPTION_KEY");
        expect(provider.requiredEnvVars).toContain("INTEGRATION_ENCRYPTION_KEY");
      }
    } finally {
      if (original === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = original;
    }
  });

  it("stops naming the encryption key once it is set", async () => {
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);
    try {
      const body = await (await integrationsGet(get("/api/integrations"))).json();
      expect(body.encryptionConfigured).toBe(true);
      for (const provider of body.providers) {
        expect(provider.missingEnvVars).not.toContain("INTEGRATION_ENCRYPTION_KEY");
      }
    } finally {
      if (original === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = original;
    }
  });

  it("never offers accounting providers to a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );

    const body = await (await integrationsGet(get("/api/integrations"))).json();
    const categories = body.providers.map((entry: { category: string }) => entry.category);
    expect(categories).not.toContain("accounting");
    expect(categories).toContain("banking");
  });

  it("answers 500 with a safe message when the connection query fails", async () => {
    db.findConnections.mockRejectedValue(new Error("column does not exist: institution_logo"));

    const response = await integrationsGet(get("/api/integrations"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load integrations" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/profile                                                    */
/* ------------------------------------------------------------------ */

describe("the profile screen", () => {
  it("returns the business profile in a Business workspace", async () => {
    db.findBusinessProfile.mockResolvedValue({
      businessType: "RETAIL",
      employeeRange: "SOLO",
      monthlyRent: decimal(1200),
      monthlyRevenue: decimal(45000.4),
      location: "Amsterdam",
      businessNotes: null,
      completedAt: new Date("2026-03-03T00:00:00Z"),
      skippedAt: null,
    });

    const response = await profileGet(get("/api/profile"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.edition).toBe("business");
    expect(body.personal).toBeNull();
    expect(body.business).toEqual({
      businessType: "RETAIL",
      employeeRange: "SOLO",
      monthlyRent: "1200.00",
      monthlyRevenue: "45000.40",
      location: "Amsterdam",
      businessNotes: null,
      completedAt: "2026-03-03T00:00:00.000Z",
      skippedAt: null,
      done: true,
    });
    expect(body.locationHint).toBe("Amsterdam");
    expect(body.supportedCurrencies).toContain("EUR");
    expect(body.profile.email).toBe("owner@example.com");
    expect(body.workspace).toEqual({
      id: "ws-1",
      name: "Acme",
      type: "BUSINESS",
      edition: "business",
    });
  });

  it("returns the goals questionnaire in a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );
    db.findPersonalProfile.mockResolvedValue({
      lifeStage: "FAMILY",
      primaryFocus: "HOME",
      monthlyIncome: decimal(4200),
      monthlyEssentials: null,
      hasDebt: true,
      emergencyMonths: 2,
      notes: "Saving for a house",
      completedAt: new Date("2026-04-04T00:00:00Z"),
      skippedAt: null,
    });

    const body = await (await profileGet(get("/api/profile"))).json();
    expect(body.edition).toBe("personal");
    expect(body.business).toBeNull();
    expect(body.personal).toEqual({
      lifeStage: "FAMILY",
      lifeStageLabel: "Raising a family",
      primaryFocus: "HOME",
      primaryFocusLabel: "Save for a home",
      monthlyIncome: "4200.00",
      monthlyEssentials: null,
      hasDebt: true,
      emergencyMonths: 2,
      notes: "Saving for a house",
      completedAt: "2026-04-04T00:00:00.000Z",
      skippedAt: null,
      done: true,
    });
  });

  it("still sends the location hint in a Personal workspace, as the page does", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );
    db.findBusinessProfile.mockResolvedValue({ location: "Berlin" });

    const body = await (await profileGet(get("/api/profile"))).json();
    expect(body.locationHint).toBe("Berlin");
  });

  it("reports an unanswered questionnaire as null", async () => {
    const body = await (await profileGet(get("/api/profile"))).json();
    expect(body.business).toBeNull();
    expect(body.personal).toBeNull();
    expect(body.locationHint).toBeNull();
  });

  it("answers 500 with a safe message when the profile lookup fails", async () => {
    db.findBusinessProfile.mockRejectedValue(new Error("relation business_profiles missing"));

    const response = await profileGet(get("/api/profile"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load profile" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/workspace                                                  */
/* ------------------------------------------------------------------ */

describe("the workspace and its team", () => {
  const MEMBER_ROW = {
    id: "member-1",
    userId: "user-1",
    role: "MEMBER" as const,
    permissions: { export_data: false },
    joinedAt: new Date("2026-05-05T08:00:00Z"),
    profile: { fullName: "Ada Lovelace", email: "owner@example.com" },
  };

  it("lists members with their effective permissions and their overrides", async () => {
    db.findMembers.mockResolvedValue([MEMBER_ROW]);
    db.countMembers.mockResolvedValue(3);
    db.countInvitations.mockResolvedValue(2);

    const response = await workspaceGet(get("/api/workspace"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.workspace).toEqual({
      id: "ws-1",
      name: "Acme",
      type: "BUSINESS",
      edition: "business",
      currency: "EUR",
      aiCategorizationEnabled: true,
      autoDunningEnabled: false,
    });
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toEqual({
      id: "member-1",
      userId: "user-1",
      role: "MEMBER",
      fullName: "Ada Lovelace",
      email: "owner@example.com",
      permissions: [
        "edit_invoices",
        "edit_transactions",
        "manage_forecast",
        "use_copilot",
        "view_invoices",
        "view_reports",
        "view_transactions",
      ],
      overrides: { export_data: false },
      joinedAt: "2026-05-05T08:00:00.000Z",
    });
    // Seat usage counts pending invitations, because the plan limit does.
    expect(body.seats).toEqual({ used: 5, limit: 5, planName: "Business" });
  });

  it("reports unlimited seats as a null limit", async () => {
    domain.getEntitlements.mockResolvedValue(
      entitlements({ plan: getPlan("ENTERPRISE", "business"), planId: "ENTERPRISE" })
    );

    const body = await (await workspaceGet(get("/api/workspace"))).json();
    expect(body.seats.limit).toBeNull();
    expect(body.seats.planName).toBe("Enterprise");
  });

  it("shows the member list to a member who cannot manage it", async () => {
    // The web page renders the roster for everyone in the workspace and only
    // gates the invite and permission controls, so read access matches.
    authorize(context({ permissions: permissionsFor("BUSINESS", ["view_transactions"]) }));
    db.findMembers.mockResolvedValue([MEMBER_ROW]);

    const response = await workspaceGet(get("/api/workspace"));
    expect(response.status).toBe(200);
    expect((await response.json()).members).toHaveLength(1);
  });

  it("has no team at all in a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );

    const body = await (await workspaceGet(get("/api/workspace"))).json();
    // null, not [] — "there is no team here" rather than "the team is empty".
    expect(body.members).toBeNull();
    expect(db.findMembers).not.toHaveBeenCalled();
    expect(body.seats.used).toBe(1);
  });

  it("answers 500 with a safe message when the member query fails", async () => {
    db.findMembers.mockRejectedValue(new Error("relation workspace_members missing"));

    const response = await workspaceGet(get("/api/workspace"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load the workspace" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/billing/summary                                            */
/* ------------------------------------------------------------------ */

describe("resolving where a plan came from", () => {
  const base = {
    ownerEmail: "someone@example.com",
    edition: "business" as const,
    planId: "BUSINESS" as const,
    stripeSubscriptionId: null,
    isTrial: false,
  };

  it("calls an allowlisted owner's plan complimentary, ahead of everything else", () => {
    expect(
      resolvePlanSource({
        ...base,
        ownerEmail: "alihbahri@gmail.com",
        stripeSubscriptionId: "sub_123",
        isTrial: true,
      })
    ).toBe("complimentary");
  });

  it("calls a paid plan with a Stripe subscription stripe", () => {
    expect(resolvePlanSource({ ...base, stripeSubscriptionId: "sub_123" })).toBe("stripe");
  });

  it("does not call a free plan stripe just because a subscription row exists", () => {
    expect(
      resolvePlanSource({ ...base, planId: "FREE", stripeSubscriptionId: "sub_123" })
    ).toBe("free");
  });

  it("calls the card-free trial trial", () => {
    expect(resolvePlanSource({ ...base, planId: "PRO", isTrial: true })).toBe("trial");
  });

  it("prefers stripe over trial for a paying customer inside a Stripe trial", () => {
    expect(
      resolvePlanSource({ ...base, planId: "PRO", stripeSubscriptionId: "sub_9", isTrial: true })
    ).toBe("stripe");
  });

  it("falls back to free", () => {
    expect(resolvePlanSource(base)).toBe("free");
    expect(resolvePlanSource({ ...base, ownerEmail: null })).toBe("free");
  });

  // google_play is real now, but only the entitlements resolver can see a Play
  // purchase, so nothing is ever inferred from a Subscription row alone. The
  // resolver-driven cases live in tests/play-billing.test.ts.
  it("never infers google_play from a Subscription row alone", () => {
    const inputs = [
      base,
      { ...base, isTrial: true },
      { ...base, stripeSubscriptionId: "sub_1" },
      { ...base, ownerEmail: "alihbahri@gmail.com" },
    ];
    for (const input of inputs) {
      expect(resolvePlanSource(input)).not.toBe("google_play");
    }
  });
});

describe("the billing summary", () => {
  it("returns the edition's line-up, the meters and the plan source", async () => {
    db.findSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_123" });
    db.findFirstMember.mockResolvedValue({ profile: { email: "owner@example.com" } });

    const response = await billingGet(get("/api/billing/summary"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.planSource).toBe("stripe");
    expect(body.plans.map((plan: { id: string }) => plan.id)).toEqual([
      "FREE",
      "PRO",
      "BUSINESS",
      "ENTERPRISE",
    ]);
    // A price list is a compiled constant, not an amount that was added to
    // anything, so it stays a number — and is offered as a string as well.
    const pro = body.plans.find((plan: { id: string }) => plan.id === "PRO");
    expect(pro.monthlyPriceEur).toBe(19);
    expect(pro.monthlyPrice).toBe("19.00");
    const enterprise = body.plans.find((plan: { id: string }) => plan.id === "ENTERPRISE");
    expect(enterprise.monthlyPriceEur).toBeNull();
    expect(enterprise.monthlyPrice).toBeNull();

    expect(body.usage).toEqual({
      aiMessages: { used: 12, limit: null },
      aiCategorizations: { used: 3, limit: null },
      csvImports: { used: 1, limit: null },
      invoiceExtractions: { used: 4, limit: 500 },
      exports: { used: 2, limit: null },
    });
    expect(body.entitlements).toMatchObject({
      planId: "BUSINESS",
      planName: "Business",
      edition: "business",
      isTrial: false,
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    });
    expect(typeof body.billingConfigured).toBe("boolean");
  });

  it("keys the complimentary grant on the workspace owner, not the caller", async () => {
    db.findFirstMember.mockResolvedValue({ profile: { email: "alihbahri@gmail.com" } });

    const body = await (await billingGet(get("/api/billing/summary"))).json();
    expect(body.planSource).toBe("complimentary");
    expect(db.findFirstMember).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", role: "OWNER" },
      select: { profile: { select: { email: true } } },
    });
  });

  it("reports a trial as a trial", async () => {
    domain.getEntitlements.mockResolvedValue(
      entitlements({
        plan: getPlan("PRO", "business"),
        planId: "PRO",
        isTrial: true,
        trialEndsAt: "2026-08-24T00:00:00.000Z",
        planSource: "TRIAL",
        hasActiveStripeSubscription: false,
      })
    );

    const body = await (await billingGet(get("/api/billing/summary"))).json();
    expect(body.planSource).toBe("trial");
    expect(body.entitlements.trialEndsAt).toBe("2026-08-24T00:00:00.000Z");
  });

  it("reports a free workspace as free", async () => {
    domain.getEntitlements.mockResolvedValue(
      entitlements({
        plan: getPlan("FREE", "business"),
        planId: "FREE",
        planSource: "FREE",
        hasActiveStripeSubscription: false,
      })
    );

    const body = await (await billingGet(get("/api/billing/summary"))).json();
    expect(body.planSource).toBe("free");
    expect(body.usage.exports).toEqual({ used: 2, limit: 0 });
  });

  it("offers only the Personal tiers to a Personal workspace", async () => {
    authorize(
      context({
        workspace: {
          id: "ws-2",
          name: "Personal",
          type: "PERSONAL",
          currency: "EUR",
          aiCategorizationEnabled: true,
          autoDunningEnabled: false,
        },
      })
    );
    domain.getEntitlements.mockResolvedValue(
      entitlements({
        plan: getPlan("PLUS", "personal"),
        planId: "PLUS",
        edition: "personal",
        workspaceType: "PERSONAL",
      })
    );

    const body = await (await billingGet(get("/api/billing/summary"))).json();
    expect(body.plans.map((plan: { id: string }) => plan.id)).toEqual(["FREE", "PLUS", "PREMIUM"]);
    expect(body.plans.find((plan: { id: string }) => plan.id === "PLUS").monthlyPrice).toBe("4.99");
    // Personal has no invoices, so the meter is present but reads zero of zero.
    expect(body.usage.invoiceExtractions.limit).toBe(0);
  });

  /**
   * The Google Play half. This is what an Android client reads to decide whether
   * to show purchase buttons at all, which is the difference between a customer
   * who already pays on the web being charged twice and not.
   */
  describe("the Google Play block", () => {
    beforeEach(() => {
      process.env.GOOGLE_PLAY_PACKAGE_NAME = "com.ballastmoney.app";
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: "play@ballast.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
      });
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      db.findFirstMember.mockResolvedValue({ profile: { email: "owner@example.com" } });
    });

    afterEach(() => {
      delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
      delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
      delete process.env.STRIPE_SECRET_KEY;
    });

    it("lists the products this edition sells, with the identifiers to buy them with", async () => {
      const body = await (await billingGet(get("/api/billing/summary"))).json();

      expect(body.play.configured).toBe(true);
      expect(body.play.packageName).toBe("com.ballastmoney.app");
      expect(body.play.products).toEqual([
        {
          productId: "business_pro",
          basePlanId: "business-pro-monthly",
          planId: "PRO",
          planName: "Pro",
        },
        {
          productId: "business_team",
          basePlanId: "business-team-monthly",
          planId: "BUSINESS",
          planName: "Business",
        },
      ]);
      // Supplied ready-made so a client never reimplements the hashing.
      expect(body.play.obfuscatedAccountId).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(body.play.obfuscatedProfileId).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(body.play.obfuscatedProfileId).not.toBe(body.play.obfuscatedAccountId);
    });

    it("never offers a business product to a personal workspace", async () => {
      authorize(
        context({
          workspace: {
            id: "ws-2",
            name: "Personal",
            type: "PERSONAL",
            currency: "EUR",
            aiCategorizationEnabled: true,
            autoDunningEnabled: false,
          },
        })
      );
      domain.getEntitlements.mockResolvedValue(
        entitlements({
          plan: getPlan("PLUS", "personal"),
          planId: "PLUS",
          edition: "personal",
          workspaceType: "PERSONAL",
        })
      );

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.play.products.map((product: { productId: string }) => product.productId)).toEqual(
        ["personal_plus", "personal_premium"]
      );
    });

    // The single most expensive mistake available: a Stripe customer installs the
    // app, taps upgrade, and is charged twice.
    it("forbids in-app purchase while Stripe is paying, and points at the portal", async () => {
      db.findSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_123" });

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.planSource).toBe("stripe");
      expect(body.management).toMatchObject({
        source: "stripe",
        canPurchaseInApp: false,
        blockedReason: "MANAGED_ON_WEB",
        portalAvailable: true,
        playManageUrl: null,
      });
    });

    it("allows in-app purchase for a workspace nobody is paying for", async () => {
      domain.getEntitlements.mockResolvedValue(
        entitlements({
          plan: getPlan("FREE", "business"),
          planId: "FREE",
          planSource: "FREE",
          hasActiveStripeSubscription: false,
          hasStripeCustomer: false,
        })
      );

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.management).toMatchObject({
        source: "free",
        canPurchaseInApp: true,
        blockedReason: null,
        portalAvailable: false,
      });
    });

    it("offers a Play subscriber the Play deep link, and says prices come from Play", async () => {
      domain.getEntitlements.mockResolvedValue(
        entitlements({
          plan: getPlan("PRO", "business"),
          planId: "PRO",
          planSource: "GOOGLE_PLAY",
          hasActiveStripeSubscription: false,
          hasStripeCustomer: false,
          play: {
            purchaseToken: "token-1",
            productId: "business_pro",
            basePlanId: "business-pro-monthly",
            state: "SUBSCRIPTION_STATE_ACTIVE",
            expiryTime: new Date("2026-09-01T00:00:00.000Z"),
            autoRenewing: true,
            acknowledged: true,
            entitling: true,
          },
        })
      );

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.planSource).toBe("google_play");
      // Google converts the base price per country, so the euro list price in
      // `plans` is not what this customer pays and the response says so.
      expect(body.priceSource).toBe("google_play");
      expect(body.play.subscription).toEqual({
        productId: "business_pro",
        basePlanId: "business-pro-monthly",
        state: "SUBSCRIPTION_STATE_ACTIVE",
        expiresAt: "2026-09-01T00:00:00.000Z",
        autoRenewing: true,
        acknowledged: true,
        entitling: true,
      });
      expect(body.management.playManageUrl).toBe(
        "https://play.google.com/store/account/subscriptions?sku=business_pro&package=com.ballastmoney.app"
      );
      expect(body.management.canPurchaseInApp).toBe(true);
    });

    it("says euro list prices apply to everyone else", async () => {
      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.priceSource).toBe("eur_list");
    });

    it("gives a complimentary account neither affordance", async () => {
      db.findFirstMember.mockResolvedValue({ profile: { email: "alihbahri@gmail.com" } });

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.management).toMatchObject({
        source: "complimentary",
        canPurchaseInApp: false,
        blockedReason: "COMPLIMENTARY",
        portalAvailable: false,
        playManageUrl: null,
      });
    });

    it("tells a client not to try buying when this server has no Play credentials", async () => {
      delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

      const body = await (await billingGet(get("/api/billing/summary"))).json();
      expect(body.play.configured).toBe(false);
      expect(body.management).toMatchObject({
        canPurchaseInApp: false,
        blockedReason: "PLAY_NOT_CONFIGURED",
      });
    });
  });

  it("answers 500 with a safe message when the subscription lookup fails", async () => {
    db.findSubscription.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const response = await billingGet(get("/api/billing/summary"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to load billing" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });
});
