import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as cancelDeletion,
  GET as getDeletion,
  POST as requestDeletion,
} from "@/app/api/account/deletion/route";
import {
  GET as cronGet,
  maxDuration as cronMaxDuration,
} from "@/app/api/cron/account-deletions/route";
import type { AccountDeletionRequest } from "@/generated/prisma/client";
import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  ACCOUNT_DELETION_MAX_DURATION_SECONDS,
  ACCOUNT_DELETION_RUN_BUDGET_MS,
  ACCOUNT_DELETION_RUN_RESERVE_MS,
  executeAccountDeletion,
  hashEmail,
  REAUTHENTICATION_MAX_AGE_SECONDS,
} from "@/lib/account/deletion";

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

/** Every side effect the executor performs, in the order it performed them. */
const trace = vi.hoisted(() => ({ order: [] as string[] }));

const auth = vi.hoisted(() => ({ resolveRequestUser: vi.fn() }));
const bearer = vi.hoisted(() => ({ verifySupabaseAccessToken: vi.fn() }));
const supa = vi.hoisted(() => ({ getSession: vi.fn(), deleteUser: vi.fn(), serviceClient: vi.fn() }));
const billing = vi.hoisted(() => ({
  isBillingConfigured: vi.fn(),
  getStripe: vi.fn(),
  cancelSubscription: vi.fn(),
}));
const providers = vi.hoisted(() => ({ getProviderHooks: vi.fn(), revoke: vi.fn() }));
const mail = vi.hoisted(() => ({
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  // Renders the body it was given, so a test can assert what the account holder
  // was actually told rather than only that something was sent.
  renderAlertEmail: vi.fn((options: { bodyText: string }) => `<html>${options.bodyText}</html>`),
}));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const db = vi.hoisted(() => ({
  findRequest: vi.fn(),
  findRequests: vi.fn(),
  createRequest: vi.fn(),
  updateRequest: vi.fn(),
  findMembers: vi.fn(),
  findSubscriptions: vi.fn(),
  findConnections: vi.fn(),
  findProfile: vi.fn(),
  deleteProfiles: vi.fn(),
  deleteWorkspaces: vi.fn(),
  findPlayPurchases: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountDeletionRequest: {
      findFirst: db.findRequest,
      findMany: db.findRequests,
      create: db.createRequest,
      update: db.updateRequest,
    },
    workspaceMember: { findMany: db.findMembers },
    subscription: { findMany: db.findSubscriptions },
    playPurchase: { findMany: db.findPlayPurchases },
    integrationConnection: { findMany: db.findConnections },
    profile: { findUnique: db.findProfile, deleteMany: db.deleteProfiles },
    workspace: { deleteMany: db.deleteWorkspaces },
  },
}));

vi.mock("@/lib/auth/request", () => ({ resolveRequestUser: auth.resolveRequestUser }));
vi.mock("@/lib/auth/bearer", () => ({
  verifySupabaseAccessToken: bearer.verifySupabaseAccessToken,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getSession: supa.getSession } }),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: supa.serviceClient }));
vi.mock("@/lib/billing/stripe", () => ({
  isBillingConfigured: billing.isBillingConfigured,
  getStripe: billing.getStripe,
}));
vi.mock("@/lib/integrations/providers", () => ({ getProviderHooks: providers.getProviderHooks }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptSecret: () => "plaintext-token" }));
vi.mock("@/lib/notifications/email", () => ({
  isEmailConfigured: mail.isEmailConfigured,
  sendEmail: mail.sendEmail,
  renderAlertEmail: mail.renderAlertEmail,
}));
vi.mock("@/lib/workspace/audit", () => ({ recordAudit: audit.recordAudit }));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "Ada@Example.com" };
const EMAIL_HASH = createHash("sha256").update("ada@example.com").digest("hex");
const NOW = new Date("2026-08-10T12:00:00.000Z");

/** The personal workspace: only the user is in it, so it goes with them. */
const PERSONAL = { id: `ws-${USER.id}`, name: "Ada" };
/** A shared workspace with another owner: it survives the deletion. */
const SHARED = { id: "ws-shared", name: "Acme Books" };

function memberships(list: { id: string; name: string }[]) {
  return list.map((workspace) => ({ workspaceId: workspace.id, workspace }));
}

function scheduledRow(overrides: Partial<AccountDeletionRequest> = {}): AccountDeletionRequest {
  return {
    id: "adr-1",
    userId: USER.id,
    emailHash: EMAIL_HASH,
    status: "SCHEDULED",
    reason: "Too expensive",
    requestedAt: new Date("2026-08-03T12:00:00.000Z"),
    scheduledFor: new Date("2026-08-10T12:00:00.000Z"),
    cancelledAt: null,
    completedAt: null,
    attempts: 0,
    lastError: null,
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    updatedAt: new Date("2026-08-03T12:00:00.000Z"),
    ...overrides,
  };
}

/**
 * The default world: the user is alone in their personal workspace and is one
 * of two owners of a shared one, so nothing blocks a deletion.
 */
function setupWorld({
  memberRows = [
    { workspaceId: PERSONAL.id, userId: USER.id, role: "OWNER" },
    { workspaceId: SHARED.id, userId: USER.id, role: "OWNER" },
    { workspaceId: SHARED.id, userId: "other-user", role: "OWNER" },
  ],
  workspaces = [PERSONAL, SHARED],
}: { memberRows?: { workspaceId: string; userId: string; role: string }[]; workspaces?: { id: string; name: string }[] } = {}) {
  db.findMembers.mockImplementation(async (args: { where?: { workspaceId?: { in: string[] } } }) => {
    if (args?.where?.workspaceId?.in) {
      const ids = args.where.workspaceId.in;
      return memberRows.filter((row) => ids.includes(row.workspaceId));
    }
    return memberships(workspaces);
  });
}

function jsonRequest(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/account/deletion", {
    method,
    headers: { "Content-Type": "application/json", authorization: "Bearer access-token", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/account-deletions", {
    headers: authorization ? { authorization } : {},
  });
}

/** Claims whose most recent authentication was `agoSeconds` ago. */
function claims(agoSeconds: number, sub: string = USER.id) {
  const at = Math.floor(NOW.getTime() / 1000) - agoSeconds;
  return { sub, email: USER.email, iat: at, amr: [{ method: "password", timestamp: at }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  trace.order.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  auth.resolveRequestUser.mockResolvedValue(USER);
  bearer.verifySupabaseAccessToken.mockResolvedValue(claims(60));
  supa.getSession.mockResolvedValue({ data: { session: { access_token: "cookie-token" } } });
  supa.deleteUser.mockImplementation(async () => {
    trace.order.push("auth-user-delete");
    return { data: {}, error: null };
  });
  supa.serviceClient.mockReturnValue({ auth: { admin: { deleteUser: supa.deleteUser } } });

  billing.isBillingConfigured.mockReturnValue(true);
  billing.cancelSubscription.mockImplementation(async () => {
    trace.order.push("stripe-cancel");
    return {};
  });
  billing.getStripe.mockReturnValue({
    subscriptions: { cancel: billing.cancelSubscription },
  });

  providers.revoke.mockImplementation(async () => {
    trace.order.push("revoke");
  });
  providers.getProviderHooks.mockReturnValue({ revoke: providers.revoke });

  mail.isEmailConfigured.mockReturnValue(true);
  mail.sendEmail.mockResolvedValue({ status: "sent", id: "msg-1" });
  audit.recordAudit.mockResolvedValue(undefined);

  db.findRequest.mockResolvedValue(null);
  db.findRequests.mockResolvedValue([]);
  db.createRequest.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...scheduledRow(),
    ...data,
    id: "adr-new",
  }));
  db.updateRequest.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    trace.order.push("request-update");
    return { ...scheduledRow(), ...data };
  });
  db.findSubscriptions.mockResolvedValue([]);
  db.findPlayPurchases.mockResolvedValue([]);
  db.findConnections.mockResolvedValue([]);
  db.findProfile.mockResolvedValue({ email: USER.email });
  db.deleteProfiles.mockImplementation(async () => {
    trace.order.push("profile-delete");
    return { count: 1 };
  });
  db.deleteWorkspaces.mockImplementation(async () => {
    trace.order.push("workspace-delete");
    return { count: 1 };
  });
  setupWorld();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

describe("who may touch a deletion", () => {
  it("answers 401 on every verb without a session", async () => {
    auth.resolveRequestUser.mockResolvedValue(null);

    for (const [handler, request] of [
      [getDeletion, jsonRequest("GET")],
      [requestDeletion, jsonRequest("POST", { confirm: "DELETE" })],
      [cancelDeletion, jsonRequest("DELETE")],
    ] as const) {
      const response = await handler(request);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
    expect(db.createRequest).not.toHaveBeenCalled();
    expect(db.updateRequest).not.toHaveBeenCalled();
  });

  it("accepts a Bearer caller, so the Android client can delete its own account", async () => {
    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(200);
    expect(bearer.verifySupabaseAccessToken).toHaveBeenCalledWith("access-token");
    // The cookie session is never consulted when a token was presented.
    expect(supa.getSession).not.toHaveBeenCalled();
  });

  it("falls back to the cookie session's token when there is no Authorization header", async () => {
    const response = await requestDeletion(
      new Request("http://localhost/api/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      })
    );

    expect(response.status).toBe(200);
    expect(bearer.verifySupabaseAccessToken).toHaveBeenCalledWith("cookie-token");
  });
});

/* ------------------------------------------------------------------ */
/* Confirmation and re-authentication                                  */
/* ------------------------------------------------------------------ */

describe("the typed confirmation", () => {
  it("refuses anything that is not the exact word", async () => {
    for (const body of [
      {},
      { confirm: "" },
      { confirm: "delete" },
      { confirm: "DELETE ME" },
      { confirm: true },
      { reason: "bored" },
    ]) {
      const response = await requestDeletion(jsonRequest("POST", body));
      expect(response.status).toBe(400);
      const parsed = (await response.json()) as { error: string; code: string };
      expect(parsed.code).toBe("INVALID_CONFIRMATION");
      expect(parsed.error.length).toBeGreaterThan(0);
    }
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("says what to type rather than emitting a schema error", async () => {
    const response = await requestDeletion(jsonRequest("POST", { confirm: "delete" }));

    expect((await response.json()).error).toContain("DELETE");
  });

  it("rejects a body that is not JSON instead of throwing", async () => {
    const response = await requestDeletion(jsonRequest("POST", "not json at all"));

    expect(response.status).toBe(400);
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("is checked before the session's freshness, so a typo never costs a re-login", async () => {
    bearer.verifySupabaseAccessToken.mockResolvedValue(claims(3_600));

    const response = await requestDeletion(jsonRequest("POST", { confirm: "nope" }));
    expect(response.status).toBe(400);
  });
});

describe("re-authentication", () => {
  it("refuses a session that authenticated longer ago than the sudo window", async () => {
    bearer.verifySupabaseAccessToken.mockResolvedValue(
      claims(REAUTHENTICATION_MAX_AGE_SECONDS + 60)
    );

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("REAUTH_REQUIRED");
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("refuses a token that belongs to somebody else", async () => {
    bearer.verifySupabaseAccessToken.mockResolvedValue(claims(30, "22222222-2222-4222-8222-222222222222"));

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("REAUTH_REQUIRED");
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("refuses a token that does not verify", async () => {
    bearer.verifySupabaseAccessToken.mockRejectedValue(new Error("ERR_JWT_EXPIRED"));

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(401);
    expect(db.createRequest).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Sole ownership                                                      */
/* ------------------------------------------------------------------ */

describe("the sole-ownership rule", () => {
  it("refuses with 409 and names the workspaces the user is the last owner of", async () => {
    setupWorld({
      memberRows: [
        { workspaceId: PERSONAL.id, userId: USER.id, role: "OWNER" },
        { workspaceId: SHARED.id, userId: USER.id, role: "OWNER" },
        { workspaceId: SHARED.id, userId: "other-user", role: "MEMBER" },
      ],
    });

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      code: string;
      workspaces: { id: string; name: string; memberCount: number }[];
    };
    expect(body.code).toBe("SOLE_OWNER");
    expect(body.workspaces).toEqual([{ id: SHARED.id, name: "Acme Books", memberCount: 2 }]);
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("allows it when somebody else also owns the shared workspace", async () => {
    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      warnings: { workspacesToDelete: { id: string }[] };
    };
    // Only the workspace nobody else is in is scheduled to go.
    expect(body.warnings.workspacesToDelete).toEqual([
      { id: PERSONAL.id, name: "Ada", memberCount: 1 },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Requesting                                                          */
/* ------------------------------------------------------------------ */

describe("requesting a deletion", () => {
  it("schedules it a grace period out and stores a hash instead of the address", async () => {
    const response = await requestDeletion(
      jsonRequest("POST", { confirm: "DELETE", reason: "Moving to a spreadsheet" })
    );

    expect(response.status).toBe(200);
    const { data } = db.createRequest.mock.calls[0][0] as {
      data: { userId: string; emailHash: string; status: string; scheduledFor: Date; requestedAt: Date };
    };
    expect(data.userId).toBe(USER.id);
    expect(data.status).toBe("SCHEDULED");
    expect(data.emailHash).toBe(EMAIL_HASH);
    expect(data.scheduledFor.getTime() - data.requestedAt.getTime()).toBe(
      ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
    );
    expect(data.scheduledFor.toISOString()).toBe("2026-08-17T12:00:00.000Z");

    // Nothing on the row or in the answer carries the address itself.
    expect(JSON.stringify(data)).not.toContain("ada@example.com");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("ada@example.com");
  });

  it("hashes the lower-cased address, so casing cannot produce two records", () => {
    expect(hashEmail("Ada@Example.com ")).toBe(hashEmail("ada@example.com"));
    expect(hashEmail("ada@example.com")).toBe(EMAIL_HASH);
  });

  it("reports the paid subscription that will be cancelled without blocking on it", async () => {
    db.findSubscriptions.mockResolvedValue([
      {
        workspaceId: PERSONAL.id,
        plan: "PRO",
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        workspace: { name: "Ada" },
      },
    ]);

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      warnings: { activeSubscriptions: { plan: string; currentPeriodEnd: string }[] };
    };
    expect(body.warnings.activeSubscriptions).toEqual([
      {
        workspaceId: PERSONAL.id,
        workspaceName: "Ada",
        plan: "PRO",
        status: "ACTIVE",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  /**
   * A Play subscription cannot be cancelled from a server — the Google Play
   * Developer API has no such call — so the only honest thing to do is tell the
   * user, before they commit, that they have to cancel it themselves, and where.
   */
  it("reports a Google Play subscription the server cannot cancel for them", async () => {
    process.env.GOOGLE_PLAY_PACKAGE_NAME = "com.ballastmoney.app";
    db.findPlayPurchases.mockResolvedValue([
      {
        workspaceId: PERSONAL.id,
        plan: "PREMIUM",
        productId: "personal_premium",
        state: "SUBSCRIPTION_STATE_ACTIVE",
        expiryTime: new Date("2026-09-01T00:00:00.000Z"),
        workspace: { name: "Ada" },
      },
    ]);

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      warnings: { playSubscriptions: Record<string, unknown>[] };
    };
    expect(body.warnings.playSubscriptions).toEqual([
      {
        workspaceId: PERSONAL.id,
        workspaceName: "Ada",
        plan: "PREMIUM",
        productId: "personal_premium",
        state: "SUBSCRIPTION_STATE_ACTIVE",
        expiresAt: "2026-09-01T00:00:00.000Z",
        manageUrl:
          "https://play.google.com/store/account/subscriptions?sku=personal_premium&package=com.ballastmoney.app",
      },
    ]);
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
  });

  it("does not warn about a Play subscription that has already expired", async () => {
    db.findPlayPurchases.mockResolvedValue([
      {
        workspaceId: PERSONAL.id,
        plan: "PREMIUM",
        productId: "personal_premium",
        state: "SUBSCRIPTION_STATE_EXPIRED",
        expiryTime: new Date("2026-07-01T00:00:00.000Z"),
        workspace: { name: "Ada" },
      },
    ]);

    const body = await (await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }))).json();
    expect(body.warnings.playSubscriptions).toEqual([]);
  });

  it("emails the account holder that the clock is running", async () => {
    await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail.mock.calls[0][0]).toBe(USER.email);
  });

  it("is idempotent: a second request returns the one already scheduled", async () => {
    db.findRequest.mockResolvedValue(scheduledRow());

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(200);
    expect((await response.json()).alreadyScheduled).toBe(true);
    expect(db.createRequest).not.toHaveBeenCalled();
  });

  it("answers 500 with a safe message when the write fails", async () => {
    db.createRequest.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.7:5432"));

    const response = await requestDeletion(jsonRequest("POST", { confirm: "DELETE" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not schedule the deletion" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.7");
  });
});

/* ------------------------------------------------------------------ */
/* Reading and cancelling                                              */
/* ------------------------------------------------------------------ */

describe("reading and cancelling", () => {
  it("reports no request when there is none", async () => {
    const response = await getDeletion(jsonRequest("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      request: null,
      gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    });
  });

  it("serializes the scheduled request with ISO timestamps and no address", async () => {
    db.findRequest.mockResolvedValue(scheduledRow());

    const body = (await (await getDeletion(jsonRequest("GET"))).json()) as {
      request: Record<string, unknown>;
    };
    expect(body.request).toEqual({
      id: "adr-1",
      status: "SCHEDULED",
      reason: "Too expensive",
      requestedAt: "2026-08-03T12:00:00.000Z",
      scheduledFor: "2026-08-10T12:00:00.000Z",
      cancelledAt: null,
      completedAt: null,
      gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    });
    expect(JSON.stringify(body)).not.toContain(EMAIL_HASH);
  });

  it("moves a scheduled request to CANCELLED", async () => {
    db.findRequest.mockResolvedValue(scheduledRow());

    const response = await cancelDeletion(jsonRequest("DELETE"));

    expect(response.status).toBe(200);
    expect(db.updateRequest).toHaveBeenCalledTimes(1);
    const call = db.updateRequest.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; cancelledAt: Date; reason: null };
    };
    expect(call.where).toEqual({ id: "adr-1" });
    expect(call.data.status).toBe("CANCELLED");
    expect(call.data.cancelledAt).toBeInstanceOf(Date);
    expect((await response.json()).request.status).toBe("CANCELLED");
    expect(audit.recordAudit).toHaveBeenCalled();
  });

  it("answers 404 when there is nothing scheduled to cancel", async () => {
    const response = await cancelDeletion(jsonRequest("DELETE"));

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_SCHEDULED");
    expect(db.updateRequest).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The cron sweep                                                      */
/* ------------------------------------------------------------------ */

describe("the deletion sweep endpoint", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-token";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("keeps the route's maxDuration and the run budget on the same number", () => {
    expect(cronMaxDuration).toBe(ACCOUNT_DELETION_MAX_DURATION_SECONDS);
    expect(ACCOUNT_DELETION_RUN_BUDGET_MS).toBe(
      cronMaxDuration * 1_000 - ACCOUNT_DELETION_RUN_RESERVE_MS
    );
  });

  it("refuses to run at all when no secret is configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await cronGet(cronRequest("Bearer anything"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cron is not configured" });
    expect(db.findRequests).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or wrong bearer token", async () => {
    for (const header of [undefined, "s3cret-token", "Bearer wrong", "bearer s3cret-token"]) {
      const response = await cronGet(cronRequest(header));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
    expect(db.findRequests).not.toHaveBeenCalled();
  });

  it("executes only the requests whose grace period has expired", async () => {
    db.findRequests.mockResolvedValue([scheduledRow()]);

    const response = await cronGet(cronRequest("Bearer s3cret-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stats: { due: 1, completed: 1, retryable: 0, failed: 0, deferred: 0 },
    });
    const query = db.findRequests.mock.calls[0][0] as {
      where: { status: string; scheduledFor: { lte: Date } };
    };
    expect(query.where.status).toBe("SCHEDULED");
    expect(query.where.scheduledFor.lte).toBeInstanceOf(Date);
  });

  it("answers 500 with a safe message when the sweep throws", async () => {
    db.findRequests.mockRejectedValue(new Error("relation does not exist at 10.0.0.7"));

    const response = await cronGet(cronRequest("Bearer s3cret-token"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Cron run failed" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.7");
  });
});

/* ------------------------------------------------------------------ */
/* The executor                                                        */
/* ------------------------------------------------------------------ */

describe("executing a deletion", () => {
  beforeEach(() => {
    db.findConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "gocardless",
        userId: USER.id,
        workspaceId: PERSONAL.id,
        accessToken: "encrypted",
      },
    ]);
    db.findSubscriptions.mockResolvedValue([
      { workspaceId: PERSONAL.id, stripeSubscriptionId: "sub_123" },
    ]);
  });

  it("withdraws bank consent and cancels billing BEFORE anything is deleted", async () => {
    await executeAccountDeletion(scheduledRow());

    expect(trace.order).toEqual([
      "revoke",
      "stripe-cancel",
      "workspace-delete",
      "profile-delete",
      "auth-user-delete",
      "request-update",
    ]);
    expect(trace.order.indexOf("revoke")).toBeLessThan(trace.order.indexOf("profile-delete"));
    expect(trace.order.indexOf("stripe-cancel")).toBeLessThan(trace.order.indexOf("profile-delete"));
  });

  it("deletes only the workspaces nobody else is in", async () => {
    await executeAccountDeletion(scheduledRow());

    expect(db.deleteWorkspaces).toHaveBeenCalledWith({ where: { id: { in: [PERSONAL.id] } } });
    expect(db.deleteProfiles).toHaveBeenCalledWith({ where: { id: USER.id } });
  });

  it("leaves a shared workspace alone and records the departure in its audit log", async () => {
    await executeAccountDeletion(scheduledRow());

    const deleted = (db.deleteWorkspaces.mock.calls[0][0] as { where: { id: { in: string[] } } })
      .where.id.in;
    expect(deleted).not.toContain(SHARED.id);
    // Written while the user id is still a valid foreign key; the schema's
    // SetNull is what anonymises it a moment later.
    expect(audit.recordAudit).toHaveBeenCalledWith(
      SHARED.id,
      USER.id,
      "account.deleted",
      expect.objectContaining({ requestId: "adr-1" })
    );
  });

  it("does not delete a workspace that gained members during the grace period", async () => {
    setupWorld({
      memberRows: [
        { workspaceId: PERSONAL.id, userId: USER.id, role: "OWNER" },
        { workspaceId: PERSONAL.id, userId: "new-joiner", role: "MEMBER" },
      ],
      workspaces: [PERSONAL],
    });

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(db.deleteWorkspaces).not.toHaveBeenCalled();
    expect(outcome.orphanedWorkspaces).toEqual([PERSONAL.id]);
    // The account still goes: the data deletion is not optional.
    expect(db.deleteProfiles).toHaveBeenCalled();
    expect(outcome.status).toBe("COMPLETED");
  });

  it("marks the request COMPLETED and drops the last of the free text", async () => {
    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    const update = db.updateRequest.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; completedAt: Date; reason: null; lastError: null };
    };
    expect(update.where).toEqual({ id: "adr-1" });
    expect(update.data.status).toBe("COMPLETED");
    expect(update.data.completedAt).toBeInstanceOf(Date);
    // The row survives as the record that a deletion happened, so the reason
    // the user typed — the last free text on it — is cleared.
    expect(update.data.reason).toBeNull();
    expect(JSON.stringify(update.data)).not.toContain("ada@example.com");
    expect(JSON.stringify(update.data)).not.toContain("Too expensive");
  });

  it("emails the confirmation to the address captured before the profile went", async () => {
    await executeAccountDeletion(scheduledRow());

    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail.mock.calls[0][0]).toBe(USER.email);
  });

  // The deletion goes ahead — a data deletion request must not be refusable on
  // the strength of a third-party billing state — but the live monthly charge is
  // counted, logged and named in the confirmation email, because only the
  // subscriber can stop it.
  it("records a Play subscription it cannot cancel and says so in the email", async () => {
    db.findPlayPurchases.mockResolvedValue([
      {
        workspaceId: PERSONAL.id,
        plan: "PREMIUM",
        productId: "personal_premium",
        state: "SUBSCRIPTION_STATE_ACTIVE",
        expiryTime: new Date("2026-09-01T00:00:00.000Z"),
        workspace: { name: "Ada" },
      },
    ]);

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.playSubscriptionsToCancel).toBe(1);
    expect(db.deleteProfiles).toHaveBeenCalled();
    const { bodyText } = mail.renderAlertEmail.mock.lastCall![0];
    expect(bodyText).toContain("Google Play");
    expect(bodyText).toContain("cancel");
  });

  it("does not tell someone with no Play subscription to cancel one", async () => {
    await executeAccountDeletion(scheduledRow());

    const { bodyText } = mail.renderAlertEmail.mock.lastCall![0];
    expect(bodyText).not.toContain("Google Play");
  });

  it("finishes the deletion when the Play lookup fails", async () => {
    db.findPlayPurchases.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.7:5432"));

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.playSubscriptionsToCancel).toBe(0);
    expect(db.deleteProfiles).toHaveBeenCalled();
  });

  it("finishes the deletion when Stripe is down", async () => {
    billing.cancelSubscription.mockRejectedValue(new Error("Stripe is unreachable"));

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.cancelledSubscriptions).toBe(0);
    expect(db.deleteProfiles).toHaveBeenCalled();
  });

  it("finishes the deletion when a provider refuses to revoke", async () => {
    providers.revoke.mockRejectedValue(new Error("GoCardless 500"));

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.revocationFailures).toBe(1);
    expect(db.deleteProfiles).toHaveBeenCalled();
  });

  it("erases the data even when the auth user cannot be removed", async () => {
    supa.serviceClient.mockReturnValue(null);

    const outcome = await executeAccountDeletion(scheduledRow());

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.authUserDeleted).toBe(false);
    expect(db.deleteProfiles).toHaveBeenCalled();
    const errors = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    expect(errors.some((line) => line.includes("account_deletion_auth_user_not_removed"))).toBe(
      true
    );
  });

  it("leaves the request retryable when the deletion itself fails", async () => {
    db.deleteProfiles.mockRejectedValue(new Error("deadlock detected"));

    const outcome = await executeAccountDeletion(scheduledRow({ attempts: 1 }));

    expect(outcome.status).toBe("RETRY");
    const update = db.updateRequest.mock.calls[0][0] as {
      data: { attempts: number; lastError: string; status?: string };
    };
    expect(update.data.attempts).toBe(2);
    expect(update.data.lastError).toContain("deadlock");
    // Still SCHEDULED, so the next sweep picks it up again.
    expect(update.data.status).toBeUndefined();
  });

  it("parks the request as FAILED once the retries are exhausted", async () => {
    db.deleteProfiles.mockRejectedValue(new Error("deadlock detected"));

    const outcome = await executeAccountDeletion(scheduledRow({ attempts: 4 }));

    expect(outcome.status).toBe("FAILED");
    const update = db.updateRequest.mock.calls[0][0] as { data: { status: string } };
    expect(update.data.status).toBe("FAILED");
  });
});
