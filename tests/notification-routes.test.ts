import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as cronGet,
  maxDuration as cronMaxDuration,
} from "@/app/api/cron/notifications/route";
import { GET as feedGet } from "@/app/api/notifications/route";
import { POST as markRead } from "@/app/api/notifications/read/route";
import {
  GET as preferencesGet,
  PATCH as preferencesPatch,
} from "@/app/api/notifications/preferences/route";

import {
  CRON_MAX_DURATION_SECONDS,
  CRON_RUN_BUDGET_MS,
  CRON_RUN_RESERVE_MS,
} from "@/lib/notifications/schedule";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const cron = vi.hoisted(() => ({ runNotificationCron: vi.fn(), runAutoDunning: vi.fn() }));
const db = vi.hoisted(() => ({
  findNotifications: vi.fn(),
  countNotifications: vi.fn(),
  updateManyNotifications: vi.fn(),
  upsertPreference: vi.fn(),
  updatePreference: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser }));
vi.mock("@/lib/notifications/cron", () => ({ runNotificationCron: cron.runNotificationCron }));
vi.mock("@/lib/invoices/dunning", () => ({ runAutoDunning: cron.runAutoDunning }));
vi.mock("@/lib/data", () => ({ getOrCreateProfile: vi.fn(async () => ({ id: "user-1" })) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: db.findNotifications,
      count: db.countNotifications,
      updateMany: db.updateManyNotifications,
    },
    notificationPreference: { upsert: db.upsertPreference, update: db.updatePreference },
  },
}));

const USER = { id: "user-1" };

const PREFERENCE_ROW = {
  dailySummary: false,
  weeklySummary: true,
  monthlySummary: true,
  largeTransaction: true,
  largeTransactionThreshold: "1000",
  lowCash: true,
  lowCashFloor: "250.5",
  lowCashHorizonDays: 30,
  invoiceReminders: true,
  channelInApp: true,
  channelEmail: true,
  channelPush: false,
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("http://localhost/api/notifications/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  auth.getUser.mockResolvedValue(USER);
  db.findNotifications.mockResolvedValue([]);
  db.countNotifications.mockResolvedValue(0);
  db.updateManyNotifications.mockResolvedValue({ count: 0 });
  db.upsertPreference.mockResolvedValue(PREFERENCE_ROW);
  db.updatePreference.mockResolvedValue(PREFERENCE_ROW);
});

/* ------------------------------------------------------------------ */
/* GET /api/cron/notifications                                         */
/* ------------------------------------------------------------------ */

describe("the cron invocation ceiling", () => {
  it("keeps the route's maxDuration and the sweep's budget on the same number", () => {
    // Next needs a literal for maxDuration, so the ceiling is written twice.
    // This is what stops the two copies from drifting apart.
    expect(cronMaxDuration).toBe(CRON_MAX_DURATION_SECONDS);
  });

  it("leaves the run enough headroom to finish a user and answer", () => {
    expect(CRON_RUN_BUDGET_MS).toBe(cronMaxDuration * 1_000 - CRON_RUN_RESERVE_MS);
    // Three digests of one user, each waiting out the 8s AI timeout, still fit
    // in the reserve.
    expect(CRON_RUN_RESERVE_MS).toBeGreaterThanOrEqual(3 * 8_000);
  });
});

describe("cron endpoint authorization", () => {
  const originalSecret = process.env.CRON_SECRET;

  function request(authorization?: string): Request {
    return new Request("http://localhost/api/cron/notifications", {
      headers: authorization ? { authorization } : {},
    });
  }

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-token";
    cron.runNotificationCron.mockResolvedValue({
      users: 2,
      usersSkipped: 1,
      summariesSent: 1,
      lowCashAlerts: 0,
      invoiceReminders: 0,
      errors: 0,
    });
    cron.runAutoDunning.mockResolvedValue({
      workspaces: 0,
      eligible: 0,
      sent: 0,
      undelivered: 0,
      errors: 0,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("refuses to run at all when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await cronGet(request("Bearer anything"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cron is not configured" });
    expect(cron.runNotificationCron).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or wrong bearer token", async () => {
    for (const header of [
      undefined,
      "s3cret-token",
      "Bearer wrong-token",
      "Bearer ",
      "bearer s3cret-token",
    ]) {
      const response = await cronGet(request(header));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
    expect(cron.runNotificationCron).not.toHaveBeenCalled();
  });

  it("runs the sweep and returns its stats for the right token", async () => {
    const response = await cronGet(request("Bearer s3cret-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stats: {
        users: 2,
        usersSkipped: 1,
        summariesSent: 1,
        lowCashAlerts: 0,
        invoiceReminders: 0,
        errors: 0,
      },
      dunning: { workspaces: 0, eligible: 0, sent: 0, undelivered: 0, errors: 0 },
    });
    expect(cron.runNotificationCron).toHaveBeenCalledTimes(1);
    expect(cron.runAutoDunning).toHaveBeenCalledTimes(1);
  });

  it("reports users the sweep could not reach in the completion log line", async () => {
    await cronGet(request("Bearer s3cret-token"));

    const lines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    const completed = lines.find((line) => line.includes("cron_notifications_completed"));
    expect(completed).toBeDefined();
    expect(JSON.parse(completed!)).toMatchObject({ users: 2, usersSkipped: 1 });
  });

  it("answers 500 with a safe message when the sweep throws", async () => {
    cron.runNotificationCron.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const response = await cronGet(request("Bearer s3cret-token"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Cron run failed" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/notifications/read                                        */
/* ------------------------------------------------------------------ */

describe("marking notifications read", () => {
  it("requires a session", async () => {
    auth.getUser.mockResolvedValue(null);
    const response = await markRead(post({ all: true }));

    expect(response.status).toBe(401);
    expect(db.updateManyNotifications).not.toHaveBeenCalled();
  });

  it("rejects a body that names neither ids nor all", async () => {
    for (const body of [{}, { all: false }, { ids: [] }, { ids: [""] }]) {
      const response = await markRead(post(body));
      expect(response.status).toBe(400);
    }
    expect(db.updateManyNotifications).not.toHaveBeenCalled();
    expect(await (await markRead(post({}))).json()).toEqual({
      error: "Provide ids or all: true",
    });
  });

  it("rejects a non-JSON body instead of throwing", async () => {
    const response = await markRead(
      new Request("http://localhost/api/notifications/read", {
        method: "POST",
        body: "not json",
      })
    );
    expect(response.status).toBe(400);
    expect(db.updateManyNotifications).not.toHaveBeenCalled();
  });

  it("rejects more than 200 ids", async () => {
    const response = await markRead(post({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) }));
    expect(response.status).toBe(400);
  });

  it("marks only the caller's unread rows when given ids", async () => {
    db.updateManyNotifications.mockResolvedValue({ count: 2 });
    const response = await markRead(post({ ids: ["n1", "n2"] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2 });
    const call = db.updateManyNotifications.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { readAt: Date };
    };
    expect(call.where).toEqual({ userId: "user-1", id: { in: ["n1", "n2"] }, readAt: null });
    expect(call.data.readAt).toBeInstanceOf(Date);
  });

  it("marks every unread row of the caller when all is true", async () => {
    db.updateManyNotifications.mockResolvedValue({ count: 7 });
    const response = await markRead(post({ all: true, ids: ["n1"] }));

    expect(await response.json()).toEqual({ updated: 7 });
    expect(
      (db.updateManyNotifications.mock.calls[0][0] as { where: Record<string, unknown> }).where
    ).toEqual({ userId: "user-1", readAt: null });
  });

  it("answers 500 with a safe message when the update fails", async () => {
    db.updateManyNotifications.mockRejectedValue(new Error("relation does not exist"));
    const response = await markRead(post({ all: true }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to update notifications" });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/notifications                                              */
/* ------------------------------------------------------------------ */

describe("the notification feed behind the bell", () => {
  it("requires a session", async () => {
    auth.getUser.mockResolvedValue(null);
    expect((await feedGet()).status).toBe(401);
  });

  it("serializes rows for the client and reports the unread count", async () => {
    db.findNotifications.mockResolvedValue([
      {
        id: "n1",
        type: "LOW_CASH",
        title: "Low cash warning",
        body: "Below your floor.",
        link: "/forecast",
        readAt: null,
        createdAt: new Date("2026-07-28T06:00:00Z"),
      },
      {
        id: "n2",
        type: "DAILY_SUMMARY",
        title: "Your daily financial summary",
        body: "Nothing much happened.",
        link: null,
        readAt: new Date("2026-07-28T07:00:00Z"),
        createdAt: new Date("2026-07-27T06:00:00Z"),
      },
    ]);
    db.countNotifications.mockResolvedValue(1);

    const response = await feedGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notifications: [
        {
          id: "n1",
          type: "LOW_CASH",
          title: "Low cash warning",
          body: "Below your floor.",
          link: "/forecast",
          read: false,
          createdAt: "2026-07-28T06:00:00.000Z",
        },
        {
          id: "n2",
          type: "DAILY_SUMMARY",
          title: "Your daily financial summary",
          body: "Nothing much happened.",
          link: null,
          read: true,
          createdAt: "2026-07-27T06:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });
  });

  it("scopes both queries to the caller and caps the page", async () => {
    await feedGet();
    expect(db.findNotifications).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(db.countNotifications).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
    });
  });
});

/* ------------------------------------------------------------------ */
/* /api/notifications/preferences                                      */
/* ------------------------------------------------------------------ */

describe("notification preferences", () => {
  it("requires a session on both verbs", async () => {
    auth.getUser.mockResolvedValue(null);
    expect((await preferencesGet()).status).toBe(401);
    expect((await preferencesPatch(patch({ dailySummary: true }))).status).toBe(401);
  });

  it("creates defaults on first read and reports which channels the server can use", async () => {
    const response = await preferencesGet();

    expect(db.upsertPreference).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: {},
      create: { userId: "user-1" },
    });
    const body = await response.json();
    expect(body.preferences).toEqual({
      ...PREFERENCE_ROW,
      largeTransactionThreshold: 1000,
      lowCashFloor: 250.5,
    });
    expect(body.channels).toEqual({
      emailConfigured: expect.any(Boolean),
      pushConfigured: expect.any(Boolean),
    });
  });

  it("rejects an empty patch and an out-of-range horizon", async () => {
    for (const body of [{}, { lowCashHorizonDays: 0 }, { lowCashHorizonDays: 400 }]) {
      const response = await preferencesPatch(patch(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Invalid preferences");
    }
    expect(db.updatePreference).not.toHaveBeenCalled();
  });

  it("drops unknown keys, so a stray field cannot reach the database", async () => {
    const response = await preferencesPatch(patch({ isAdmin: true }));
    expect(response.status).toBe(400);
    expect(db.updatePreference).not.toHaveBeenCalled();
  });

  it("persists only the fields that were sent", async () => {
    const response = await preferencesPatch(
      patch({ dailySummary: true, largeTransactionThreshold: "2500" })
    );

    expect(response.status).toBe(200);
    expect(db.updatePreference).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { dailySummary: true, largeTransactionThreshold: 2500 },
    });
  });

  it("answers 500 with a safe message when the write fails", async () => {
    db.updatePreference.mockRejectedValue(new Error("deadlock detected"));
    const response = await preferencesPatch(patch({ channelEmail: false }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to update preferences" });
  });
});
