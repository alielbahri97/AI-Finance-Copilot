import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayPurchase, Subscription } from "@/generated/prisma/client";
import { obfuscatedAccountId, obfuscatedProfileId } from "@/lib/billing/play/identity";
import { PLAY_NOTIFICATION, PLAY_STATE } from "@/lib/billing/play/state";

/**
 * The two Play Billing endpoints, and the reconciliation behind them.
 *
 * Google itself is mocked at the module boundary — `getPlaySubscription` and the
 * acknowledgement call — so every branch that matters here (identifier matching,
 * idempotent re-verification, the Stripe collision, linked-token retirement,
 * refunds) is exercised without a service-account credential.
 */

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

const google = vi.hoisted(() => ({
  getPlaySubscription: vi.fn(),
  tryAcknowledge: vi.fn(),
}));
const push = vi.hoisted(() => ({ verifyPubsubPush: vi.fn() }));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const guard = vi.hoisted(() => ({ requireWorkspace: vi.fn() }));
const db = vi.hoisted(() => ({
  findPlayPurchase: vi.fn(),
  findPlayPurchases: vi.fn(),
  upsertPlayPurchase: vi.fn(),
  updatePlayPurchase: vi.fn(),
  updateManyPlayPurchases: vi.fn(),
  findSubscription: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  findWorkspace: vi.fn(),
  findFirstMember: vi.fn(),
  createUsage: vi.fn(),
}));

class FakePlayApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, message = "google said no", reason: string | null = null) {
    super(message);
    this.name = "PlayApiError";
    this.status = status;
    this.reason = reason;
  }
  get isNotFound() {
    return this.status === 404 || this.status === 410;
  }
  get isRetryable() {
    return this.status === 429 || this.status >= 500;
  }
}

vi.mock("@/lib/billing/play/api", () => ({
  getPlaySubscription: google.getPlaySubscription,
  tryAcknowledgePlaySubscription: google.tryAcknowledge,
  acknowledgePlaySubscription: vi.fn(),
  playAccessToken: vi.fn(),
  resetPlayAccessTokenCache: vi.fn(),
  PlayApiError: FakePlayApiError,
}));

vi.mock("@/lib/billing/play/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/play/notifications")>();
  return { ...actual, verifyPubsubPush: push.verifyPubsubPush };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playPurchase: {
      findUnique: db.findPlayPurchase,
      findMany: db.findPlayPurchases,
      upsert: db.upsertPlayPurchase,
      update: db.updatePlayPurchase,
      updateMany: db.updateManyPlayPurchases,
    },
    subscription: {
      findUnique: db.findSubscription,
      create: db.createSubscription,
      findUniqueOrThrow: db.findSubscription,
      update: db.updateSubscription,
    },
    workspace: { findUnique: db.findWorkspace },
    workspaceMember: { findFirst: db.findFirstMember },
    usageRecord: { upsert: db.createUsage },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/workspace/audit", () => ({ recordAudit: audit.recordAudit }));
vi.mock("@/lib/workspace/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/context")>();
  return { ...actual, requireWorkspace: guard.requireWorkspace };
});
vi.mock("@/lib/api/rate-limit-guard", () => ({ enforceRateLimit: async () => null }));

const { POST: verifyPost } = await import("@/app/api/billing/play/verify/route");
const { POST: notificationsPost } = await import(
  "@/app/api/billing/play/notifications/route"
);
const { GET: ackCronGet } = await import("@/app/api/cron/play-acknowledge/route");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-08-10T12:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "ws-1";
const TOKEN = "play-token-abc";
const PACKAGE = "com.ballastmoney.app";

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    plan: "FREE",
    status: "ACTIVE",
    planSource: "FREE",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    stripePlan: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function playRow(overrides: Partial<PlayPurchase> = {}): PlayPurchase {
  return {
    id: "pp_1",
    purchaseToken: TOKEN,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    productId: "business_pro",
    basePlanId: "business-pro-monthly",
    plan: "PRO",
    state: PLAY_STATE.active,
    latestOrderId: "GPA.1",
    startTime: NOW,
    expiryTime: new Date(NOW.getTime() + 20 * 86_400_000),
    autoRenewing: true,
    linkedPurchaseToken: null,
    retiredAt: null,
    revokedAt: null,
    acknowledged: false,
    acknowledgedAt: null,
    ackAttempts: 0,
    ackError: null,
    obfuscatedAccountId: obfuscatedAccountId(USER_ID),
    obfuscatedProfileId: obfuscatedProfileId(WORKSPACE_ID),
    lastNotificationType: null,
    raw: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface PurchaseOverrides {
  state?: string;
  productId?: string;
  expiryTime?: string | null;
  acknowledged?: boolean;
  linkedPurchaseToken?: string | null;
  accountId?: string;
  profileId?: string;
}

function googlePurchase(overrides: PurchaseOverrides = {}) {
  return {
    subscriptionState: overrides.state ?? PLAY_STATE.active,
    acknowledgementState: overrides.acknowledged
      ? "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
      : "ACKNOWLEDGEMENT_STATE_PENDING",
    startTime: "2026-08-01T00:00:00.000Z",
    latestOrderId: "GPA.1",
    linkedPurchaseToken: overrides.linkedPurchaseToken ?? undefined,
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: overrides.accountId ?? obfuscatedAccountId(USER_ID),
      obfuscatedExternalProfileId: overrides.profileId ?? obfuscatedProfileId(WORKSPACE_ID),
    },
    lineItems: [
      {
        productId: overrides.productId ?? "business_pro",
        expiryTime:
          overrides.expiryTime === undefined ? "2026-09-01T00:00:00.000Z" : overrides.expiryTime,
        autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId: "business-pro-monthly" },
      },
    ],
  };
}

function authorize(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER", type = "BUSINESS") {
  guard.requireWorkspace.mockResolvedValue({
    ok: true,
    ctx: {
      user: { id: USER_ID, email: "ada@example.com" },
      workspace: { id: WORKSPACE_ID, name: "Acme", type, currency: "EUR" },
      role,
      memberId: "m1",
      permissions: new Set(["view_billing"]),
    },
  });
}

function verifyRequest(body: unknown = { purchaseToken: TOKEN }) {
  return new Request("http://localhost/api/billing/play/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pushRequest(notification: unknown) {
  return new Request("http://localhost/api/billing/play/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer google-oidc-token" },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString("base64"),
        messageId: "msg-1",
        publishTime: NOW.toISOString(),
      },
      subscription: "projects/ballast/subscriptions/play-rtdn",
    }),
  });
}

function subscriptionNotification(
  notificationType: number,
  purchaseToken = TOKEN,
  productId = "business_pro"
) {
  return {
    version: "1.0",
    packageName: PACKAGE,
    eventTimeMillis: String(NOW.getTime()),
    subscriptionNotification: {
      version: "1.0",
      notificationType,
      purchaseToken,
      subscriptionId: productId,
    },
  };
}

/** The last `data` object written to the resolved Subscription row. */
function lastResolvedWrite(): Record<string, unknown> | null {
  const calls = db.updateSubscription.mock.calls.filter(
    (call) => (call[0] as { data?: Record<string, unknown> })?.data?.planSource !== undefined
  );
  const last = calls.at(-1);
  return last ? ((last[0] as { data: Record<string, unknown> }).data ?? null) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_PLAY_PACKAGE_NAME = PACKAGE;
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "play@ballast.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
  });
  process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE = "https://app.ballastmoney.com/api/billing/play/notifications";

  authorize();
  push.verifyPubsubPush.mockResolvedValue({ ok: true, email: null });
  google.getPlaySubscription.mockResolvedValue(googlePurchase());
  google.tryAcknowledge.mockResolvedValue({ ok: true });

  db.findPlayPurchase.mockResolvedValue(null);
  db.findPlayPurchases.mockResolvedValue([]);
  db.upsertPlayPurchase.mockImplementation(async (args: { create?: Partial<PlayPurchase> }) =>
    playRow(args.create ?? {})
  );
  db.updatePlayPurchase.mockImplementation(async () => playRow());
  db.updateManyPlayPurchases.mockResolvedValue({ count: 1 });
  db.findSubscription.mockResolvedValue(subscriptionRow());
  db.updateSubscription.mockImplementation(async () => subscriptionRow());
  db.findWorkspace.mockResolvedValue({ type: "BUSINESS" });
  db.findFirstMember.mockResolvedValue({ profile: { email: "owner@example.com" } });
  db.createUsage.mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    period: "2026-08",
    aiMessages: 0,
    aiCategorizations: 0,
    csvImports: 0,
    invoiceExtractions: 0,
    exports: 0,
  });
});

afterEach(() => {
  delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
});

/* ------------------------------------------------------------------ */
/* POST /api/billing/play/verify                                       */
/* ------------------------------------------------------------------ */

describe("verifying a Play purchase", () => {
  it("accepts a purchase whose identifiers match, and acknowledges it server-side", async () => {
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.purchase).toMatchObject({
      productId: "business_pro",
      basePlanId: "business-pro-monthly",
      planId: "PRO",
      planName: "Pro",
      state: PLAY_STATE.active,
      acknowledged: true,
      alreadyKnown: false,
    });
    expect(body.manageUrl).toContain("sku=business_pro");

    // Acknowledged here rather than in the client, so entitlement and
    // acknowledgement cannot diverge — Google refunds an unacknowledged
    // purchase after three days.
    expect(google.tryAcknowledge).toHaveBeenCalledWith("business_pro", TOKEN);
    expect(db.upsertPlayPurchase).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      WORKSPACE_ID,
      USER_ID,
      "billing.play_purchase_verified",
      expect.objectContaining({ productId: "business_pro", plan: "PRO" })
    );
  });

  it("writes the resolved plan onto the subscription row", async () => {
    db.findPlayPurchases.mockResolvedValue([playRow()]);
    await verifyPost(verifyRequest());
    expect(lastResolvedWrite()).toMatchObject({
      plan: "PRO",
      status: "ACTIVE",
      planSource: "GOOGLE_PLAY",
    });
  });

  it("is idempotent: re-presenting a known token grants the same thing once", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow({ acknowledged: true }));
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ acknowledged: true }));

    const first = await verifyPost(verifyRequest());
    const second = await verifyPost(verifyRequest());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).purchase.alreadyKnown).toBe(true);
    // Already acknowledged at Google: no second acknowledgement is attempted.
    expect(google.tryAcknowledge).not.toHaveBeenCalled();
    // One upsert per call, on the same unique token, so no duplicate row.
    for (const call of db.upsertPlayPurchase.mock.calls) {
      expect((call[0] as { where: { purchaseToken: string } }).where).toEqual({
        purchaseToken: TOKEN,
      });
    }
  });

  it("refuses a purchase made for another workspace, and says to use the web", async () => {
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ profileId: obfuscatedProfileId("ws-other") })
    );

    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("PURCHASE_WORKSPACE_MISMATCH");
    expect(body.error).toContain("one subscription per product per Google account");
    expect(db.upsertPlayPurchase).not.toHaveBeenCalled();
  });

  it("refuses a purchase made by another user", async () => {
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ accountId: obfuscatedAccountId("someone-else") })
    );
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PURCHASE_USER_MISMATCH");
  });

  it("refuses a purchase with no identifiers, which cannot be placed at all", async () => {
    google.getPlaySubscription.mockResolvedValue({
      ...googlePurchase(),
      externalAccountIdentifiers: undefined,
    });
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PURCHASE_IDENTIFIERS_MISSING");
  });

  // The most expensive mistake available: charging twice.
  it("refuses a Play purchase for a workspace Stripe already pays for", async () => {
    db.findSubscription.mockResolvedValue(
      subscriptionRow({
        plan: "BUSINESS",
        status: "ACTIVE",
        planSource: "STRIPE",
        stripePlan: "BUSINESS",
        stripeStatus: "ACTIVE",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_stripe_1",
      })
    );

    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("STRIPE_SUBSCRIPTION_ACTIVE");
    // Not acknowledged, which is what makes Google refund it automatically.
    expect(body.refundExpected).toBe(true);
    expect(google.tryAcknowledge).not.toHaveBeenCalled();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      WORKSPACE_ID,
      USER_ID,
      "billing.play_purchase_rejected",
      expect.objectContaining({ reason: "STRIPE_SUBSCRIPTION_ACTIVE" })
    );
  });

  // The reverse order must not break a working Play customer: someone who bought
  // in the app and later added a web subscription still keeps their entitlement
  // when the client re-verifies on resume.
  it("does not retire a known Play purchase just because Stripe is now active too", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow({ acknowledged: true }));
    db.findSubscription.mockResolvedValue(
      subscriptionRow({
        plan: "BUSINESS",
        status: "ACTIVE",
        planSource: "STRIPE",
        stripePlan: "BUSINESS",
        stripeStatus: "ACTIVE",
        stripeSubscriptionId: "sub_stripe_1",
      })
    );
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ acknowledged: true }));

    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("refuses a product the workspace's edition does not sell", async () => {
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ productId: "personal_premium" }));
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PRODUCT_NOT_OFFERED");
  });

  it("refuses an unknown product id rather than guessing a tier", async () => {
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ productId: "gold_tier" }));
    expect((await verifyPost(verifyRequest())).status).toBe(409);
  });

  it("records but does not grant a purchase that is on hold", async () => {
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ state: PLAY_STATE.onHold }));
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("PURCHASE_NOT_ACTIVE");
    expect(body.state).toBe(PLAY_STATE.onHold);
    // The row is still written — support questions are about exactly these —
    // but nothing is acknowledged, because acknowledgement confirms a grant.
    expect(db.upsertPlayPurchase).toHaveBeenCalled();
    expect(google.tryAcknowledge).not.toHaveBeenCalled();
  });

  it("grants a purchase in its grace period", async () => {
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ state: PLAY_STATE.inGracePeriod })
    );
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(200);
  });

  it("answers 404 when Google does not know the token", async () => {
    google.getPlaySubscription.mockRejectedValue(new FakePlayApiError(404));
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("PURCHASE_NOT_FOUND");
  });

  it("answers 502 when Google cannot be reached, so the client retries", async () => {
    google.getPlaySubscription.mockRejectedValue(new FakePlayApiError(503));
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("PLAY_UNAVAILABLE");
  });

  it("answers 503 when this server has no Play credentials", async () => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PLAY_NOT_CONFIGURED");
  });

  it("rejects a body with no purchase token", async () => {
    expect((await verifyPost(verifyRequest({}))).status).toBe(400);
  });

  it("lets only owners and admins buy a plan", async () => {
    authorize("MEMBER");
    const response = await verifyPost(verifyRequest());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("passes an unauthenticated caller straight through to 401", async () => {
    guard.requireWorkspace.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    expect((await verifyPost(verifyRequest())).status).toBe(401);
  });

  it("retires the token a new purchase replaces", async () => {
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ linkedPurchaseToken: "old-token" })
    );
    await verifyPost(verifyRequest());
    expect(db.updateManyPlayPurchases).toHaveBeenCalledWith({
      where: { purchaseToken: "old-token", retiredAt: null },
      data: { retiredAt: expect.any(Date) },
    });
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/billing/play/notifications                                */
/* ------------------------------------------------------------------ */

describe("receiving a real-time developer notification", () => {
  it("refuses a push whose OIDC token does not verify", async () => {
    push.verifyPubsubPush.mockResolvedValue({ ok: false, reason: "wrong_audience" });
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed))
    );
    expect(response.status).toBe(401);
    // Nothing is read or written before the push is authenticated.
    expect(db.findPlayPurchase).not.toHaveBeenCalled();
    expect(google.getPlaySubscription).not.toHaveBeenCalled();
  });

  it("answers 503 when no Pub/Sub audience is configured", async () => {
    delete process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed))
    );
    expect(response.status).toBe(503);
  });

  // Google's explicit guidance: a notification says something changed, not what
  // it changed to. Everything is re-read from subscriptionsv2.get.
  it("re-reads the truth from Google instead of trusting the payload", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ state: PLAY_STATE.onHold }));

    // The payload claims a renewal; Google says the subscription is on hold.
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed))
    );
    expect(response.status).toBe(200);
    expect(google.getPlaySubscription).toHaveBeenCalledWith(TOKEN);
    const body = await response.json();
    expect(body.state).toBe(PLAY_STATE.onHold);
    expect(body.entitling).toBe(false);
  });

  const stateCases: { notification: number; state: string; entitling: boolean }[] = [
    { notification: PLAY_NOTIFICATION.purchased, state: PLAY_STATE.active, entitling: true },
    { notification: PLAY_NOTIFICATION.renewed, state: PLAY_STATE.active, entitling: true },
    { notification: PLAY_NOTIFICATION.recovered, state: PLAY_STATE.active, entitling: true },
    { notification: PLAY_NOTIFICATION.restarted, state: PLAY_STATE.active, entitling: true },
    {
      notification: PLAY_NOTIFICATION.priceChangeConfirmed,
      state: PLAY_STATE.active,
      entitling: true,
    },
    { notification: PLAY_NOTIFICATION.deferred, state: PLAY_STATE.active, entitling: true },
    // Grace period keeps access; account hold does not. Both directions.
    {
      notification: PLAY_NOTIFICATION.inGracePeriod,
      state: PLAY_STATE.inGracePeriod,
      entitling: true,
    },
    { notification: PLAY_NOTIFICATION.onHold, state: PLAY_STATE.onHold, entitling: false },
    // Cancelled keeps access to the end of the paid period.
    { notification: PLAY_NOTIFICATION.canceled, state: PLAY_STATE.canceled, entitling: true },
    { notification: PLAY_NOTIFICATION.paused, state: PLAY_STATE.paused, entitling: false },
    {
      notification: PLAY_NOTIFICATION.pauseScheduleChanged,
      state: PLAY_STATE.paused,
      entitling: false,
    },
    { notification: PLAY_NOTIFICATION.expired, state: PLAY_STATE.expired, entitling: false },
    {
      notification: PLAY_NOTIFICATION.pendingPurchaseCanceled,
      state: PLAY_STATE.pendingPurchaseCanceled,
      entitling: false,
    },
  ];

  for (const testCase of stateCases) {
    it(`maps notification ${testCase.notification} onto ${testCase.entitling ? "access" : "no access"}`, async () => {
      db.findPlayPurchase.mockResolvedValue(playRow());
      google.getPlaySubscription.mockResolvedValue(googlePurchase({ state: testCase.state }));

      const response = await notificationsPost(
        pushRequest(subscriptionNotification(testCase.notification))
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.state).toBe(testCase.state);
      expect(body.entitling).toBe(testCase.entitling);
    });
  }

  it("cuts access immediately on a revocation, not at period end", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    // Google still reports an unexpired active purchase; the refund overrides it.
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ state: PLAY_STATE.active }));

    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.revoked))
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entitling).toBe(false);
    const written = db.upsertPlayPurchase.mock.calls.at(-1)?.[0] as {
      update: { revokedAt: Date | null; retiredAt: Date | null };
    };
    expect(written.update.revokedAt).toBeInstanceOf(Date);
    expect(written.update.retiredAt).toBeInstanceOf(Date);
  });

  it("treats a voided purchase — a chargeback — the same way", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    const response = await notificationsPost(
      pushRequest({
        version: "1.0",
        packageName: PACKAGE,
        voidedPurchaseNotification: {
          purchaseToken: TOKEN,
          orderId: "GPA.1",
          productType: 2,
          refundType: 1,
        },
      })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entitling).toBe(false);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      WORKSPACE_ID,
      null,
      "billing.play_notification",
      expect.objectContaining({ notification: "VOIDED_PURCHASE" })
    );
  });

  // The classic Play Billing bug. An upgrade mints a fresh token linked to the
  // old one; leaving the old row live gives the workspace two apparently active
  // subscriptions, and a downgrade then resolves to the tier the customer just
  // stopped paying for.
  it("retires the linked token on an upgrade, and attributes the new one", async () => {
    const oldToken = "play-token-old";
    db.findPlayPurchase.mockImplementation(
      async ({ where }: { where: { purchaseToken: string } }) =>
        where.purchaseToken === oldToken
          ? playRow({ purchaseToken: oldToken, plan: "PRO", productId: "business_pro" })
          : null
    );
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ productId: "business_team", linkedPurchaseToken: oldToken })
    );

    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.purchased, "play-token-new"))
    );

    expect(response.status).toBe(200);
    // Attributed to the predecessor's workspace even though the new token was
    // never seen before.
    const created = db.upsertPlayPurchase.mock.calls.at(-1)?.[0] as {
      create: { workspaceId: string; plan: string };
    };
    expect(created.create.workspaceId).toBe(WORKSPACE_ID);
    expect(created.create.plan).toBe("BUSINESS");
    // And the old row is retired.
    expect(db.updateManyPlayPurchases).toHaveBeenCalledWith({
      where: { purchaseToken: oldToken, retiredAt: null },
      data: { retiredAt: expect.any(Date) },
    });
  });

  it("never retires a token that links to itself", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ linkedPurchaseToken: TOKEN }));
    await notificationsPost(pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed)));
    expect(db.updateManyPlayPurchases).not.toHaveBeenCalled();
  });

  it("acknowledges the Play Console test notification and does nothing else", async () => {
    const response = await notificationsPost(
      pushRequest({ version: "1.0", packageName: PACKAGE, testNotification: { version: "1.0" } })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).test).toBe(true);
    expect(google.getPlaySubscription).not.toHaveBeenCalled();
  });

  it("stops redelivery of a token it cannot attribute to any workspace", async () => {
    db.findPlayPurchase.mockResolvedValue(null);
    google.getPlaySubscription.mockResolvedValue(googlePurchase());
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed, "stranger-token"))
    );
    expect(response.status).toBe(202);
    expect((await response.json()).ignored).toBe("unknown_token");
  });

  it("asks Pub/Sub to redeliver when Google itself is unavailable", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    google.getPlaySubscription.mockRejectedValue(new FakePlayApiError(500));
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed))
    );
    expect(response.status).toBe(500);
  });

  it("retires a purchase Google no longer recognises", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    google.getPlaySubscription.mockRejectedValue(new FakePlayApiError(404));
    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.expired))
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entitling).toBe(false);
    expect(db.updatePlayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ where: { purchaseToken: TOKEN } })
    );
  });

  it("ignores a notification for a different application", async () => {
    const response = await notificationsPost(
      pushRequest({
        ...subscriptionNotification(PLAY_NOTIFICATION.renewed),
        packageName: "com.someone.else",
      })
    );
    expect(response.status).toBe(202);
    expect((await response.json()).ignored).toBe("wrong_package");
  });

  it("audits every notification it applies", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    await notificationsPost(pushRequest(subscriptionNotification(PLAY_NOTIFICATION.inGracePeriod)));
    expect(audit.recordAudit).toHaveBeenCalledWith(
      WORKSPACE_ID,
      null,
      "billing.play_notification",
      expect.objectContaining({
        notification: "SUBSCRIPTION_IN_GRACE_PERIOD",
        notificationType: PLAY_NOTIFICATION.inGracePeriod,
        messageId: "msg-1",
      })
    );
  });

  it("writes the resolved plan back onto the subscription row", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    db.findPlayPurchases.mockResolvedValue([playRow()]);
    await notificationsPost(pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed)));
    expect(lastResolvedWrite()).toMatchObject({ plan: "PRO", planSource: "GOOGLE_PLAY" });
  });

  it("drops the cached plan back to Free when the last purchase expires", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow());
    google.getPlaySubscription.mockResolvedValue(
      googlePurchase({ state: PLAY_STATE.expired, expiryTime: "2026-08-01T00:00:00.000Z" })
    );
    db.findPlayPurchases.mockResolvedValue([]);

    await notificationsPost(pushRequest(subscriptionNotification(PLAY_NOTIFICATION.expired)));
    expect(lastResolvedWrite()).toMatchObject({ plan: "FREE", planSource: "FREE" });
  });
});

/* ------------------------------------------------------------------ */
/* The payer leaving the workspace                                     */
/* ------------------------------------------------------------------ */

/**
 * `POST /api/workspace/leave` deletes a membership row and nothing else, and the
 * entitlement belongs to the workspace rather than to whoever paid: the purchase
 * row's user id is a record of who bought it, never part of resolving it.
 */
describe("when the person who paid leaves the workspace", () => {
  it("keeps the workspace on its plan with no payer attached to the row", async () => {
    db.findPlayPurchase.mockResolvedValue(playRow({ userId: null }));
    db.findPlayPurchases.mockResolvedValue([playRow({ userId: null })]);

    const response = await notificationsPost(
      pushRequest(subscriptionNotification(PLAY_NOTIFICATION.renewed))
    );

    expect(response.status).toBe(200);
    expect((await response.json()).entitling).toBe(true);
    expect(lastResolvedWrite()).toMatchObject({ plan: "PRO", planSource: "GOOGLE_PLAY" });
  });

  it("looks purchases up by workspace only, so no membership can orphan one", async () => {
    db.findPlayPurchases.mockResolvedValue([playRow()]);
    await verifyPost(verifyRequest());

    for (const call of db.findPlayPurchases.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where).toEqual({ workspaceId: WORKSPACE_ID, retiredAt: null });
      expect(where).not.toHaveProperty("userId");
    }
  });
});

/* ------------------------------------------------------------------ */
/* The acknowledgement retry sweep                                     */
/* ------------------------------------------------------------------ */

/**
 * Google refunds and revokes a purchase nobody acknowledged within three days,
 * so an acknowledgement that failed at purchase time has to be chased rather
 * than forgotten.
 */
describe("the acknowledgement retry sweep", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  function cronRequest(secret = "cron-secret") {
    return new Request("http://localhost/api/cron/play-acknowledge", {
      headers: { Authorization: `Bearer ${secret}` },
    });
  }

  it("acknowledges every purchase still waiting for it", async () => {
    db.findPlayPurchases.mockResolvedValue([playRow({ acknowledged: false })]);

    const response = await ackCronGet(cronRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).stats).toEqual({
      considered: 1,
      acknowledged: 1,
      failed: 0,
      skipped: 0,
    });
    expect(google.tryAcknowledge).toHaveBeenCalledWith("business_pro", TOKEN);
    expect(db.findPlayPurchases).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { acknowledged: false, retiredAt: null, revokedAt: null },
      })
    );
  });

  it("counts a failure instead of pretending it worked", async () => {
    db.findPlayPurchases.mockResolvedValue([playRow({ acknowledged: false })]);
    google.tryAcknowledge.mockResolvedValue({ ok: false, error: "quota exceeded" });

    const body = await (await ackCronGet(cronRequest())).json();
    expect(body.stats).toMatchObject({ considered: 1, acknowledged: 0, failed: 1 });
    // The failure is recorded on the row so the next sweep finds it again.
    const update = db.updatePlayPurchase.mock.calls.at(-1)?.[0] as {
      data: { ackAttempts: unknown; ackError: string };
    };
    expect(update.data.ackAttempts).toEqual({ increment: 1 });
    expect(update.data.ackError).toBe("quota exceeded");
  });

  // Acknowledgement is what stops the refund, so acknowledging something that
  // grants nothing would confirm a purchase the customer should get back.
  it("never acknowledges a purchase that does not entitle", async () => {
    db.findPlayPurchases.mockResolvedValue([playRow({ acknowledged: false })]);
    google.getPlaySubscription.mockResolvedValue(googlePurchase({ state: PLAY_STATE.onHold }));

    const body = await (await ackCronGet(cronRequest())).json();
    expect(body.stats).toMatchObject({ considered: 1, acknowledged: 0, skipped: 1 });
    expect(google.tryAcknowledge).not.toHaveBeenCalled();
  });

  it("refuses a caller with the wrong secret", async () => {
    expect((await ackCronGet(cronRequest("guess"))).status).toBe(401);
    expect(db.findPlayPurchases).not.toHaveBeenCalled();
  });

  it("refuses to run at all with no CRON_SECRET set", async () => {
    delete process.env.CRON_SECRET;
    expect((await ackCronGet(cronRequest())).status).toBe(503);
  });

  it("does nothing when Play is not configured on this server", async () => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    const body = await (await ackCronGet(cronRequest())).json();
    expect(body.skipped).toBe("play_not_configured");
    expect(db.findPlayPurchases).not.toHaveBeenCalled();
  });
});
