import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as webCallback } from "@/app/api/integrations/[provider]/callback/route";
import { POST as finalize } from "@/app/api/integrations/gocardless/finalize/route";
import { POST as link } from "@/app/api/integrations/gocardless/link/route";
import { IntegrationError } from "@/lib/integrations/oauth";
import { PENDING_CONNECTION_TTL_MS } from "@/lib/integrations/pending-connections";

/**
 * The native bank-connection handshake: POST /link hands a consent URL to a
 * client that will open it in a Custom Tab, POST /finalize turns the reference
 * it echoes back into a connection. The web redirect flow is exercised too,
 * because it now runs on the same pending rows instead of a cookie.
 *
 * No database and no network: the pending table is an in-memory list so the
 * two-tabs case can be asserted row by row.
 */

const auth = vi.hoisted(() => ({ requireWorkspace: vi.fn(), getWorkspaceContext: vi.fn() }));
const billing = vi.hoisted(() => ({ getEntitlements: vi.fn() }));
const gc = vi.hoisted(() => ({ createRequisition: vi.fn(), finalizeRequisition: vi.fn() }));
const integrations = vi.hoisted(() => ({
  saveConnection: vi.fn(),
  recordBankAccounts: vi.fn(),
  recordAudit: vi.fn(),
}));
const db = vi.hoisted(() => ({
  createPending: vi.fn(),
  findPending: vi.fn(),
  updatePending: vi.fn(),
  deleteManyPending: vi.fn(),
  countConnections: vi.fn(),
  findConnection: vi.fn(),
  findBankAccounts: vi.fn(),
}));

vi.mock("@/lib/workspace/context", () => ({
  requireWorkspace: auth.requireWorkspace,
  getWorkspaceContext: auth.getWorkspaceContext,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: billing.getEntitlements,
  upgradeError: (feature: string) => ({ error: `${feature} needs an upgrade`, code: "UPGRADE_REQUIRED" }),
}));
vi.mock("@/lib/integrations/providers/gocardless", () => ({
  createRequisition: gc.createRequisition,
  finalizeRequisition: gc.finalizeRequisition,
}));
// The callback route only needs the OAuth2 hooks, which nothing here uses;
// stubbing the barrel keeps every other provider's module out of the graph.
vi.mock("@/lib/integrations/providers", () => ({ getProviderHooks: () => ({}) }));
vi.mock("@/lib/integrations/connections", () => ({ saveConnection: integrations.saveConnection }));
vi.mock("@/lib/integrations/bank-accounts", () => ({
  recordBankAccounts: integrations.recordBankAccounts,
}));
vi.mock("@/lib/workspace/audit", () => ({ recordAudit: integrations.recordAudit }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingBankConnection: {
      create: db.createPending,
      findUnique: db.findPending,
      update: db.updatePending,
      deleteMany: db.deleteManyPending,
    },
    integrationConnection: { count: db.countConnections, findFirst: db.findConnection },
    bankAccount: { findMany: db.findBankAccounts },
  },
}));

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const OTHER_USER = { id: "22222222-2222-4222-8222-222222222222" };
const WORKSPACE = { id: "ws-1", type: "PERSONAL" };
const OTHER_WORKSPACE = { id: "ws-2", type: "PERSONAL" };

const CTX = {
  user: USER,
  workspace: WORKSPACE,
  role: "OWNER",
  memberId: "member-1",
  permissions: new Set(["manage_integrations"]),
};

interface PendingRow {
  id: string;
  workspaceId: string;
  userId: string;
  provider: string;
  requisitionId: string;
  reference: string;
  institutionId: string;
  link: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  connectionId: string | null;
  error: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let pendingRows: PendingRow[] = [];
let nextPendingId = 1;

function seedPending(overrides: Partial<PendingRow> = {}): PendingRow {
  const row: PendingRow = {
    id: `pending-${nextPendingId++}`,
    workspaceId: WORKSPACE.id,
    userId: USER.id,
    provider: "gocardless",
    requisitionId: "req-seed",
    reference: `${USER.id}:seed`,
    institutionId: "SANDBOXFINANCE_SFIN0000",
    link: "https://bank.example/consent/seed",
    status: "PENDING",
    connectionId: null,
    error: null,
    expiresAt: new Date(Date.now() + PENDING_CONNECTION_TTL_MS),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  pendingRows.push(row);
  return row;
}

const FINALIZED = {
  accounts: ["acc-1"],
  institutionId: "SANDBOXFINANCE_SFIN0000",
  institutionName: "Sandbox Finance",
  institutionLogo: "https://cdn.example/logo.png",
  accountDetails: [{ id: "acc-1", mask: "…1234", name: "Current account" }],
  consentExpiresAt: "2026-11-02T10:00:00.000Z",
  maxHistoricalDays: 90,
};

const CONNECTION = {
  id: "conn-1",
  provider: "gocardless",
  status: "CONNECTED",
  institutionName: "Sandbox Finance",
  institutionLogo: "https://cdn.example/logo.png",
  workspaceId: WORKSPACE.id,
};

function linkRequest(body?: unknown): Request {
  return new Request("http://localhost/api/integrations/gocardless/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function finalizeRequest(body: unknown): Request {
  return new Request("http://localhost/api/integrations/gocardless/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function callbackRequest(query: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/integrations/gocardless/callback${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

const GOCARDLESS_PARAMS = { params: Promise.resolve({ provider: "gocardless" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  process.env.GOCARDLESS_SECRET_ID = "secret-id";
  process.env.GOCARDLESS_SECRET_KEY = "secret-key";
  process.env.GOCARDLESS_INSTITUTION_ID = "SANDBOXFINANCE_SFIN0000";
  process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);

  pendingRows = [];
  nextPendingId = 1;

  auth.requireWorkspace.mockResolvedValue({ ok: true, ctx: CTX });
  auth.getWorkspaceContext.mockResolvedValue(CTX);
  billing.getEntitlements.mockResolvedValue({
    planId: "FREE",
    edition: "personal",
    // Unlimited banks unless a test says otherwise.
    plan: { name: "Free", limits: { integrationsEnabled: true, bankConnections: null } },
  });

  gc.createRequisition.mockImplementation(async () => ({
    requisitionId: `req-${gc.createRequisition.mock.calls.length}`,
    link: `https://bank.example/consent/${gc.createRequisition.mock.calls.length}`,
  }));
  gc.finalizeRequisition.mockResolvedValue(FINALIZED);
  integrations.saveConnection.mockResolvedValue(CONNECTION);
  integrations.recordBankAccounts.mockResolvedValue(undefined);
  integrations.recordAudit.mockResolvedValue(undefined);

  db.createPending.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = {
      id: `pending-${nextPendingId++}`,
      status: "PENDING",
      connectionId: null,
      error: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as PendingRow;
    pendingRows.push(row);
    return row;
  });
  db.findPending.mockImplementation(
    async ({ where }: { where: { reference: string } }) =>
      pendingRows.find((row) => row.reference === where.reference) ?? null
  );
  db.updatePending.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Partial<PendingRow> }) => {
      const row = pendingRows.find((entry) => entry.id === where.id);
      if (!row) throw new Error("pending row not found");
      Object.assign(row, data);
      return row;
    }
  );
  db.deleteManyPending.mockImplementation(
    async ({
      where,
    }: {
      where: { workspaceId: string; userId: string; status: string; expiresAt: { lt: Date } };
    }) => {
      const kept = pendingRows.filter(
        (row) =>
          !(
            row.workspaceId === where.workspaceId &&
            row.userId === where.userId &&
            row.status === where.status &&
            row.expiresAt < where.expiresAt.lt
          )
      );
      const count = pendingRows.length - kept.length;
      pendingRows = kept;
      return { count };
    }
  );
  db.countConnections.mockResolvedValue(0);
  db.findConnection.mockResolvedValue(CONNECTION);
  db.findBankAccounts.mockResolvedValue([
    {
      id: "bank-acc-1",
      externalAccountId: "acc-1",
      name: "Current account",
      mask: "…1234",
      currency: "EUR",
      includeInTotals: true,
      lastBalance: 1234.5,
      lastBalanceAt: new Date("2026-08-10T09:00:00Z"),
    },
  ]);
});

/* ------------------------------------------------------------------ */
/* POST /api/integrations/gocardless/link                              */
/* ------------------------------------------------------------------ */

describe("starting a bank connection from a native client", () => {
  it("passes the guard chain through to the caller", async () => {
    auth.requireWorkspace.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    expect((await link(linkRequest())).status).toBe(401);
    expect(gc.createRequisition).not.toHaveBeenCalled();
  });

  it("refuses a workspace whose plan has no integrations", async () => {
    billing.getEntitlements.mockResolvedValue({
      planId: "FREE",
      edition: "business",
      plan: { name: "Free", limits: { integrationsEnabled: false, bankConnections: 0 } },
    });

    const response = await link(linkRequest());
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe("UPGRADE_REQUIRED");
    expect(gc.createRequisition).not.toHaveBeenCalled();
  });

  it("answers 503 while the server has no GoCardless secrets", async () => {
    delete process.env.GOCARDLESS_SECRET_KEY;
    const response = await link(linkRequest());

    expect(response.status).toBe(503);
    expect(gc.createRequisition).not.toHaveBeenCalled();
  });

  it("refuses the plan's bank limit BEFORE a consent link exists", async () => {
    // The point of the whole ordering: the user must never find out about the
    // limit while sitting on their bank's approval screen.
    billing.getEntitlements.mockResolvedValue({
      planId: "FREE",
      edition: "personal",
      plan: { name: "Free", limits: { integrationsEnabled: true, bankConnections: 1 } },
    });
    db.countConnections.mockResolvedValue(1);

    const response = await link(linkRequest());
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.code).toBe("LIMIT_REACHED");
    expect(body.error).toContain("Free plan includes 1 bank connection");
    expect(gc.createRequisition).not.toHaveBeenCalled();
    expect(db.createPending).not.toHaveBeenCalled();
    expect(pendingRows).toHaveLength(0);
  });

  it("rejects an institution id that is not one", async () => {
    const response = await link(linkRequest({ institutionId: "../../etc/passwd" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("institutionId");
    expect(gc.createRequisition).not.toHaveBeenCalled();
  });

  it("returns the consent link and stores the attempt against caller and workspace", async () => {
    const before = Date.now();
    const response = await link(linkRequest({ institutionId: "REVOLUT_REVOGB21" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      link: "https://bank.example/consent/1",
      requisitionId: "req-1",
      reference: expect.stringContaining(`${USER.id}:`),
      institutionId: "REVOLUT_REVOGB21",
      expiresAt: expect.any(String),
    });
    // The reference keeps its "<userId>:<hex>" shape with a 16-byte tail.
    expect(body.reference).toMatch(new RegExp(`^${USER.id}:[0-9a-f]{32}$`));
    expect(gc.createRequisition).toHaveBeenCalledWith("REVOLUT_REVOGB21", body.reference);

    const expiresAt = new Date(body.expiresAt).getTime();
    expect(body.expiresAt).toBe(new Date(expiresAt).toISOString());
    expect(expiresAt - before).toBeGreaterThanOrEqual(PENDING_CONNECTION_TTL_MS - 5_000);
    expect(expiresAt - before).toBeLessThanOrEqual(PENDING_CONNECTION_TTL_MS + 5_000);

    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]).toMatchObject({
      workspaceId: WORKSPACE.id,
      userId: USER.id,
      provider: "gocardless",
      requisitionId: "req-1",
      reference: body.reference,
      institutionId: "REVOLUT_REVOGB21",
      link: "https://bank.example/consent/1",
      status: "PENDING",
      connectionId: null,
    });

    expect(integrations.recordAudit).toHaveBeenCalledWith(
      WORKSPACE.id,
      USER.id,
      "integration.connect_started",
      { provider: "gocardless", institution: "REVOLUT_REVOGB21", requisitionId: "req-1" }
    );
  });

  it("falls back to the server's default bank when the body is empty", async () => {
    const response = await link(linkRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).institutionId).toBe("SANDBOXFINANCE_SFIN0000");
  });

  it("clears out this user's abandoned attempts, and only theirs", async () => {
    const mine = seedPending({
      reference: "mine-expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const theirs = seedPending({
      userId: OTHER_USER.id,
      reference: "theirs-expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const live = seedPending({ reference: "mine-live" });

    await link(linkRequest());

    const references = pendingRows.map((row) => row.reference);
    expect(references).not.toContain(mine.reference);
    expect(references).toContain(theirs.reference);
    expect(references).toContain(live.reference);
  });

  it("reports a GoCardless failure as a bad gateway rather than a 500", async () => {
    gc.createRequisition.mockRejectedValue(
      new IntegrationError("GoCardless /requisitions/ failed: HTTP 400 — unknown institution")
    );

    const response = await link(linkRequest());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("unknown institution");
    expect(pendingRows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/integrations/gocardless/finalize                          */
/* ------------------------------------------------------------------ */

describe("finalizing a bank connection from a native client", () => {
  it("rejects a body without a reference", async () => {
    const response = await finalize(finalizeRequest({}));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("reference is required");
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
  });

  it("reports an unknown reference as not found", async () => {
    const response = await finalize(finalizeRequest({ reference: "nobody:cafe" }));

    expect(response.status).toBe(404);
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
  });

  it("never finalizes a reference belonging to another user", async () => {
    const theirs = seedPending({ userId: OTHER_USER.id, reference: `${OTHER_USER.id}:abc` });

    const response = await finalize(finalizeRequest({ reference: theirs.reference }));

    expect(response.status).toBe(404);
    // Indistinguishable from an unknown reference: the message must not
    // confirm that someone else's attempt exists.
    expect(await response.json()).toEqual({
      error: "No pending bank connection matches that reference.",
      code: "NOT_FOUND",
    });
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(integrations.saveConnection).not.toHaveBeenCalled();
    expect(pendingRows[0].status).toBe("PENDING");
  });

  it("never finalizes a reference belonging to another workspace", async () => {
    // Same person, second workspace: the connection would land in the wrong
    // set of books.
    const elsewhere = seedPending({
      workspaceId: OTHER_WORKSPACE.id,
      reference: `${USER.id}:elsewhere`,
    });

    const response = await finalize(finalizeRequest({ reference: elsewhere.reference }));

    expect(response.status).toBe(404);
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(integrations.saveConnection).not.toHaveBeenCalled();
  });

  it("refuses an attempt whose approval window has closed", async () => {
    const stale = seedPending({
      reference: `${USER.id}:stale`,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await finalize(finalizeRequest({ reference: stale.reference }));

    expect(response.status).toBe(410);
    expect((await response.json()).error).toContain("expired");
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
  });

  it("refuses an attempt that already failed, with the reason it failed", async () => {
    const failed = seedPending({
      reference: `${USER.id}:failed`,
      status: "FAILED",
      error: "Your bank granted no access. Try again.",
    });

    const response = await finalize(finalizeRequest({ reference: failed.reference }));

    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe("Your bank granted no access. Try again.");
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
  });

  it("is idempotent once the attempt has completed", async () => {
    const done = seedPending({
      reference: `${USER.id}:done`,
      status: "COMPLETED",
      connectionId: CONNECTION.id,
    });

    const response = await finalize(finalizeRequest({ reference: done.reference }));

    expect(response.status).toBe(200);
    expect((await response.json()).connection.id).toBe(CONNECTION.id);
    // No second requisition read, and above all no second connection.
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(integrations.saveConnection).not.toHaveBeenCalled();
  });

  it("tells a client whose completed connection has since been disconnected", async () => {
    seedPending({
      reference: `${USER.id}:gone`,
      status: "COMPLETED",
      connectionId: "conn-deleted",
    });
    db.findConnection.mockResolvedValue(null);

    const response = await finalize(finalizeRequest({ reference: `${USER.id}:gone` }));
    expect(response.status).toBe(410);
    expect(integrations.saveConnection).not.toHaveBeenCalled();
  });

  it("stores the connection, its accounts and the audit trail, then completes the row", async () => {
    const row = seedPending({ reference: `${USER.id}:live`, requisitionId: "req-live" });

    const response = await finalize(finalizeRequest({ reference: row.reference }));

    expect(response.status).toBe(200);
    expect(gc.finalizeRequisition).toHaveBeenCalledWith("req-live");
    expect(integrations.saveConnection).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE.id, userId: USER.id },
      "gocardless",
      expect.objectContaining({
        externalId: FINALIZED.institutionId,
        institutionName: "Sandbox Finance",
      })
    );
    expect(integrations.recordBankAccounts).toHaveBeenCalledWith(CONNECTION.id, [
      { externalAccountId: "acc-1", name: "Current account", mask: "…1234" },
    ]);
    expect(integrations.recordAudit).toHaveBeenCalledWith(
      WORKSPACE.id,
      USER.id,
      "integration.connected",
      expect.objectContaining({ provider: "gocardless", connectionId: CONNECTION.id })
    );

    expect(await response.json()).toEqual({
      connection: {
        id: CONNECTION.id,
        provider: "gocardless",
        status: "CONNECTED",
        institutionName: "Sandbox Finance",
        institutionLogo: "https://cdn.example/logo.png",
        accounts: [
          {
            id: "bank-acc-1",
            externalAccountId: "acc-1",
            name: "Current account",
            mask: "…1234",
            currency: "EUR",
            includeInTotals: true,
            // Wire contract: money is a decimal string, instants are ISO UTC.
            balance: "1234.50",
            balanceAt: "2026-08-10T09:00:00.000Z",
          },
        ],
      },
    });

    expect(row.status).toBe("COMPLETED");
    expect(row.connectionId).toBe(CONNECTION.id);
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  it("marks the attempt failed and answers 502 when the bank side did not complete", async () => {
    const row = seedPending({ reference: `${USER.id}:rejected`, requisitionId: "req-rejected" });
    gc.finalizeRequisition.mockRejectedValue(
      new IntegrationError("Your bank returned no accounts. Try connecting again.")
    );

    const response = await finalize(finalizeRequest({ reference: row.reference }));

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe(
      "Your bank returned no accounts. Try connecting again."
    );
    expect(row.status).toBe("FAILED");
    expect(row.error).toBe("Your bank returned no accounts. Try connecting again.");
    expect(integrations.saveConnection).not.toHaveBeenCalled();
  });

  it("marks the attempt failed and hides an unexpected error behind a 500", async () => {
    const row = seedPending({ reference: `${USER.id}:boom` });
    integrations.saveConnection.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const response = await finalize(finalizeRequest({ reference: row.reference }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not complete the bank connection" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    expect(row.status).toBe("FAILED");
  });
});

/* ------------------------------------------------------------------ */
/* Two tabs, two banks                                                 */
/* ------------------------------------------------------------------ */

describe("two connections started at once", () => {
  it("keeps an attempt per tab, and finalizing one leaves the other alone", async () => {
    const first = await (await link(linkRequest({ institutionId: "ING_INGBNL2A" }))).json();
    const second = await (await link(linkRequest({ institutionId: "RABOBANK_RABONL2U" }))).json();

    // The cookie this replaced had one slot, so the second start used to
    // overwrite the first and that tab could never finish.
    expect(pendingRows).toHaveLength(2);
    expect(first.reference).not.toBe(second.reference);
    expect(pendingRows.map((row) => row.requisitionId)).toEqual(["req-1", "req-2"]);
    expect(pendingRows.every((row) => row.status === "PENDING")).toBe(true);

    const response = await finalize(finalizeRequest({ reference: second.reference }));
    expect(response.status).toBe(200);
    expect(gc.finalizeRequisition).toHaveBeenCalledWith("req-2");

    const [firstRow, secondRow] = pendingRows;
    expect(secondRow.status).toBe("COMPLETED");
    expect(firstRow).toMatchObject({
      reference: first.reference,
      requisitionId: "req-1",
      status: "PENDING",
      connectionId: null,
    });

    // And the first tab can still finish afterwards.
    gc.finalizeRequisition.mockResolvedValue({ ...FINALIZED, institutionId: "ING_INGBNL2A" });
    expect((await finalize(finalizeRequest({ reference: first.reference }))).status).toBe(200);
    expect(firstRow.status).toBe("COMPLETED");
  });
});

/* ------------------------------------------------------------------ */
/* The web redirect flow, now on the same rows                         */
/* ------------------------------------------------------------------ */

describe("the browser callback on database-backed state", () => {
  it("finalizes the attempt named by ?ref and redirects to the new connection", async () => {
    const row = seedPending({ reference: `${USER.id}:web`, requisitionId: "req-web" });

    const response = await webCallback(
      callbackRequest(`?ref=${encodeURIComponent(row.reference)}`),
      GOCARDLESS_PARAMS
    );

    expect(gc.finalizeRequisition).toHaveBeenCalledWith("req-web");
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/integrations?connected=gocardless&connection=${CONNECTION.id}`
    );
    expect(row.status).toBe("COMPLETED");
    expect(row.connectionId).toBe(CONNECTION.id);
  });

  it("refuses a ref that belongs to somebody else", async () => {
    const theirs = seedPending({ userId: OTHER_USER.id, reference: `${OTHER_USER.id}:web` });

    const response = await webCallback(
      callbackRequest(`?ref=${encodeURIComponent(theirs.reference)}`),
      GOCARDLESS_PARAMS
    );

    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=That+bank+approval+belongs");
    expect(theirs.status).toBe("PENDING");
  });

  it("does not connect a second time when the callback is reloaded", async () => {
    const row = seedPending({
      reference: `${USER.id}:replay`,
      status: "COMPLETED",
      connectionId: CONNECTION.id,
    });

    const response = await webCallback(
      callbackRequest(`?ref=${encodeURIComponent(row.reference)}`),
      GOCARDLESS_PARAMS
    );

    expect(response.headers.get("location")).toContain(`connection=${CONNECTION.id}`);
    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(integrations.saveConnection).not.toHaveBeenCalled();
  });

  it("asks a handshake that started on the old cookie to start again", async () => {
    // Someone already at their bank when this shipped comes back with a cookie
    // and no row to find. Honouring the cookie would mean finalizing whichever
    // requisition it happened to hold without being able to check it against
    // the `ref` the bank just echoed — the very mismatch the row prevents — so
    // the deliberate choice is to retire the cookie outright and ask for a
    // retry. The exposure is one bank approval for anyone mid-handshake during
    // a deploy, against carrying an unverifiable code path indefinitely.
    const response = await webCallback(
      callbackRequest("", "intg_gc_req=req-legacy.user-1%3Aoldref"),
      GOCARDLESS_PARAMS
    );

    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=The+connection+session+expired");
  });

  it("sends the user back to try again when there is neither a row nor a cookie", async () => {
    const response = await webCallback(callbackRequest(""), GOCARDLESS_PARAMS);

    expect(gc.finalizeRequisition).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=The+connection+session+expired");
  });
});
