import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationPreference } from "@/generated/prisma/client";
import { runNotificationCron } from "@/lib/notifications/cron";

const db = vi.hoisted(() => ({
  findMemberships: vi.fn(),
  findLatestTransaction: vi.fn(),
  updatePreference: vi.fn(),
}));
const deps = vi.hoisted(() => ({
  getOrCreatePreferences: vi.fn(),
  dispatchNotification: vi.fn(),
  generateSummary: vi.fn(),
  checkLowCash: vi.fn(),
  checkInvoiceReminders: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceMember: { findMany: db.findMemberships },
    transaction: { findFirst: db.findLatestTransaction },
    notificationPreference: { update: db.updatePreference },
  },
}));

vi.mock("@/lib/notifications/preferences", () => ({
  getOrCreatePreferences: deps.getOrCreatePreferences,
}));
vi.mock("@/lib/notifications/dispatch", () => ({
  dispatchNotification: deps.dispatchNotification,
}));
vi.mock("@/lib/notifications/summaries", () => ({ generateSummary: deps.generateSummary }));
vi.mock("@/lib/notifications/alerts", () => ({
  checkLowCash: deps.checkLowCash,
  checkInvoiceReminders: deps.checkInvoiceReminders,
}));

// 2026-07-28 is a Tuesday, so only the daily summary can ever be due.
const TUESDAY = new Date("2026-07-28T06:00:00Z");

function membership(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    role: "OWNER",
    permissions: null,
    workspace: { id: "ws-1", currency: "EUR" },
    profile: { email: "owner@example.com", aiProvider: "OPENAI" },
    ...overrides,
  };
}

function prefs(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    dailySummary: false,
    weeklySummary: false,
    monthlySummary: false,
    lastDailySentAt: null,
    lastWeeklySentAt: null,
    lastMonthlySentAt: null,
    lowCash: false,
    lowCashFloor: 0,
    lowCashHorizonDays: 30,
    lastLowCashAt: null,
    invoiceReminders: false,
    lastInvoiceRemindAt: null,
    channelInApp: true,
    channelEmail: true,
    channelPush: false,
    ...overrides,
  } as unknown as NotificationPreference;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.findMemberships.mockResolvedValue([]);
  db.findLatestTransaction.mockResolvedValue(null);
  db.updatePreference.mockResolvedValue({});
  deps.dispatchNotification.mockResolvedValue({ email: { status: "sent", id: "re_msg_1" } });
  deps.getOrCreatePreferences.mockResolvedValue(prefs());
  deps.generateSummary.mockResolvedValue({
    type: "DAILY_SUMMARY",
    title: "Your daily financial summary",
    periodLabel: "Covering the last 24 hours",
    body: "Nothing much happened.",
    stats: [{ label: "Net", value: "€0.00" }],
  });
  deps.checkLowCash.mockResolvedValue({ triggered: false });
  deps.checkInvoiceReminders.mockResolvedValue({ triggered: false });
});

/* ------------------------------------------------------------------ */
/* Membership grouping and workspace selection                         */
/* ------------------------------------------------------------------ */

describe("runNotificationCron membership handling", () => {
  it("reports zero work for an empty instance", async () => {
    db.findMemberships.mockResolvedValue([]);
    expect(await runNotificationCron(TUESDAY)).toEqual({
      users: 0,
      usersSkipped: 0,
      summariesSent: 0,
      lowCashAlerts: 0,
      invoiceReminders: 0,
      errors: 0,
      email: { sent: 0, notConfigured: 0, failed: 0, domainRestricted: 0, messageIds: [] },
    });
  });

  it("counts a member of two workspaces once", async () => {
    db.findMemberships.mockResolvedValue([
      membership(),
      membership({ workspace: { id: "ws-2", currency: "USD" } }),
    ]);
    const stats = await runNotificationCron(TUESDAY);
    expect(stats.users).toBe(1);
    expect(deps.getOrCreatePreferences).toHaveBeenCalledTimes(1);
  });

  it("skips a member who cannot view reports anywhere", async () => {
    db.findMemberships.mockResolvedValue([
      membership({ role: "VIEWER", permissions: { view_reports: false } }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.users).toBe(1);
    expect(stats.summariesSent).toBe(0);
    expect(deps.generateSummary).not.toHaveBeenCalled();
  });

  it("digests the workspace with the most recent transaction, not the first membership", async () => {
    db.findMemberships.mockResolvedValue([
      membership(),
      membership({ workspace: { id: "ws-2", currency: "USD" } }),
    ]);
    db.findLatestTransaction.mockResolvedValue({ workspaceId: "ws-2" });
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    await runNotificationCron(TUESDAY);
    expect(deps.generateSummary).toHaveBeenCalledWith(
      "ws-2",
      { currency: "USD", aiProvider: "OPENAI" },
      "daily"
    );
  });

  it("falls back to the first viewable workspace when no workspace has transactions", async () => {
    db.findMemberships.mockResolvedValue([
      membership(),
      membership({ workspace: { id: "ws-2", currency: "USD" } }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    await runNotificationCron(TUESDAY);
    expect(deps.generateSummary.mock.calls[0][0]).toBe("ws-1");
  });

  it("does not query for a primary workspace when there is only one candidate", async () => {
    db.findMemberships.mockResolvedValue([membership()]);
    await runNotificationCron(TUESDAY);
    expect(db.findLatestTransaction).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

describe("runNotificationCron summaries", () => {
  beforeEach(() => {
    db.findMemberships.mockResolvedValue([membership()]);
  });

  it("sends nothing when every summary is switched off", async () => {
    const stats = await runNotificationCron(TUESDAY);
    expect(stats.summariesSent).toBe(0);
    expect(deps.dispatchNotification).not.toHaveBeenCalled();
  });

  it("claims the slot before dispatching, so a concurrent run cannot double-send", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    const stats = await runNotificationCron(TUESDAY);

    expect(db.updatePreference).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { lastDailySentAt: TUESDAY },
    });
    expect(db.updatePreference.mock.invocationCallOrder[0]).toBeLessThan(
      deps.dispatchNotification.mock.invocationCallOrder[0]
    );
    expect(stats.summariesSent).toBe(1);
  });

  it("does not resend a summary already sent earlier the same UTC day", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ dailySummary: true, lastDailySentAt: new Date("2026-07-28T01:00:00Z") })
    );
    const stats = await runNotificationCron(TUESDAY);
    expect(stats.summariesSent).toBe(0);
    expect(db.updatePreference).not.toHaveBeenCalled();
  });

  it("dispatches the digest with a rendered email and a dashboard link", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    await runNotificationCron(TUESDAY);

    const [target, , event] = deps.dispatchNotification.mock.calls[0] as [
      { id: string; email: string },
      unknown,
      { type: string; link: string; emailSubject: string; emailHtml: string },
    ];
    expect(target).toEqual({ id: "user-1", email: "owner@example.com" });
    expect(event.type).toBe("DAILY_SUMMARY");
    expect(event.link).toBe("/dashboard");
    expect(event.emailSubject).toBe("Your daily financial summary");
    expect(event.emailHtml).toContain("Your daily financial summary");
    expect(event.emailHtml).toContain("€0.00");
  });

  it("sends the weekly and monthly digests when they fall due together", async () => {
    // 2026-06-01 is a Monday and the 1st of the month.
    const monday1st = new Date("2026-06-01T06:00:00Z");
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ dailySummary: true, weeklySummary: true, monthlySummary: true })
    );

    const stats = await runNotificationCron(monday1st);
    expect(stats.summariesSent).toBe(3);
    expect(deps.generateSummary.mock.calls.map((call) => call[2])).toEqual([
      "daily",
      "weekly",
      "monthly",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

describe("runNotificationCron alerts", () => {
  beforeEach(() => {
    db.findMemberships.mockResolvedValue([membership()]);
  });

  it("does not evaluate low cash when the alert is switched off", async () => {
    await runNotificationCron(TUESDAY);
    expect(deps.checkLowCash).not.toHaveBeenCalled();
  });

  it("does not re-evaluate low cash after it already fired today", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ lowCash: true, lastLowCashAt: new Date("2026-07-28T00:05:00Z") })
    );
    await runNotificationCron(TUESDAY);
    expect(deps.checkLowCash).not.toHaveBeenCalled();
  });

  it("stamps nothing when the condition does not hold", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ lowCash: true }));
    const stats = await runNotificationCron(TUESDAY);
    expect(deps.checkLowCash).toHaveBeenCalledWith("ws-1", "EUR", expect.anything());
    expect(db.updatePreference).not.toHaveBeenCalled();
    expect(stats.lowCashAlerts).toBe(0);
  });

  it("stamps and dispatches a triggered low-cash alert to the workspace chat", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ lowCash: true }));
    deps.checkLowCash.mockResolvedValue({
      triggered: true,
      title: "Low cash warning",
      body: "Below your floor.",
      emailHtml: "<p>Below your floor.</p>",
    });

    const stats = await runNotificationCron(TUESDAY);

    expect(db.updatePreference).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { lastLowCashAt: TUESDAY },
    });
    expect(deps.dispatchNotification.mock.calls[0][2]).toMatchObject({
      type: "LOW_CASH",
      link: "/forecast",
      chatWorkspaceId: "ws-1",
    });
    expect(stats.lowCashAlerts).toBe(1);
  });

  it("does not post to the workspace chat for a member who does not own it", async () => {
    db.findMemberships.mockResolvedValue([membership({ role: "ADMIN" })]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ lowCash: true }));
    deps.checkLowCash.mockResolvedValue({
      triggered: true,
      title: "Low cash warning",
      body: "Below your floor.",
      emailHtml: "<p>x</p>",
    });

    await runNotificationCron(TUESDAY);
    expect(deps.dispatchNotification.mock.calls[0][2]).toMatchObject({
      chatWorkspaceId: undefined,
    });
  });

  it("skips invoice reminders for a member without the invoice permission", async () => {
    db.findMemberships.mockResolvedValue([
      membership({ role: "MEMBER", permissions: { view_invoices: false } }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ invoiceReminders: true }));

    await runNotificationCron(TUESDAY);
    expect(deps.checkInvoiceReminders).not.toHaveBeenCalled();
  });

  it("stamps and dispatches a triggered invoice reminder", async () => {
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ invoiceReminders: true }));
    deps.checkInvoiceReminders.mockResolvedValue({
      triggered: true,
      title: "2 invoices need attention",
      body: "1 overdue · 1 due this week",
      emailHtml: "<p>invoices</p>",
    });

    const stats = await runNotificationCron(TUESDAY);

    expect(db.updatePreference).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { lastInvoiceRemindAt: TUESDAY },
    });
    expect(deps.dispatchNotification.mock.calls[0][2]).toMatchObject({
      type: "INVOICE_REMINDER",
      link: "/invoices",
    });
    expect(stats.invoiceReminders).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Permission scopes                                                   */
/* ------------------------------------------------------------------ */

describe("runNotificationCron permission scopes", () => {
  it("reminds a member who may see invoices but not reports", async () => {
    db.findMemberships.mockResolvedValue([
      membership({ role: "MEMBER", permissions: { view_reports: false } }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ dailySummary: true, lowCash: true, invoiceReminders: true })
    );
    deps.checkInvoiceReminders.mockResolvedValue({
      triggered: true,
      title: "1 invoice needs attention",
      body: "1 overdue",
      emailHtml: "<p>invoices</p>",
    });

    const stats = await runNotificationCron(TUESDAY);

    expect(deps.checkInvoiceReminders).toHaveBeenCalledWith("ws-1", "EUR");
    expect(stats.invoiceReminders).toBe(1);
    // The digest and the low-cash alert read report data, which this member
    // may not see, so neither is even evaluated.
    expect(deps.generateSummary).not.toHaveBeenCalled();
    expect(deps.checkLowCash).not.toHaveBeenCalled();
    expect(stats.summariesSent).toBe(0);
    expect(stats.lowCashAlerts).toBe(0);
  });

  it("takes each notification from the workspace whose data the member may see", async () => {
    db.findMemberships.mockResolvedValue([
      membership({ role: "MEMBER", permissions: { view_invoices: false } }),
      membership({
        role: "MEMBER",
        permissions: { view_reports: false },
        workspace: { id: "ws-2", currency: "USD" },
      }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ dailySummary: true, invoiceReminders: true })
    );
    deps.checkInvoiceReminders.mockResolvedValue({
      triggered: true,
      title: "1 invoice needs attention",
      body: "1 overdue",
      emailHtml: "<p>invoices</p>",
    });

    await runNotificationCron(TUESDAY);

    expect(deps.generateSummary.mock.calls[0][0]).toBe("ws-1");
    expect(deps.checkInvoiceReminders).toHaveBeenCalledWith("ws-2", "USD");
  });

  it("still withholds reminders from a member without invoice access anywhere", async () => {
    db.findMemberships.mockResolvedValue([
      membership({ role: "MEMBER", permissions: { view_invoices: false } }),
      membership({
        role: "MEMBER",
        permissions: { view_invoices: false },
        workspace: { id: "ws-2", currency: "USD" },
      }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ invoiceReminders: true }));

    const stats = await runNotificationCron(TUESDAY);

    expect(deps.checkInvoiceReminders).not.toHaveBeenCalled();
    expect(stats.invoiceReminders).toBe(0);
    expect(db.updatePreference).not.toHaveBeenCalled();
  });

  it("evaluates nothing at all for a member with neither permission", async () => {
    db.findMemberships.mockResolvedValue([
      membership({
        role: "VIEWER",
        permissions: { view_reports: false, view_invoices: false },
      }),
    ]);
    deps.getOrCreatePreferences.mockResolvedValue(
      prefs({ dailySummary: true, lowCash: true, invoiceReminders: true })
    );

    const stats = await runNotificationCron(TUESDAY);

    expect(stats.users).toBe(1);
    expect(deps.generateSummary).not.toHaveBeenCalled();
    expect(deps.checkLowCash).not.toHaveBeenCalled();
    expect(deps.checkInvoiceReminders).not.toHaveBeenCalled();
    expect(deps.dispatchNotification).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Email delivery reporting                                            */
/* ------------------------------------------------------------------ */

describe("runNotificationCron email reporting", () => {
  beforeEach(() => {
    db.findMemberships.mockResolvedValue([membership()]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));
  });

  it("reports the Resend message id of a delivered digest", async () => {
    const stats = await runNotificationCron(TUESDAY);
    expect(stats.email).toEqual({
      sent: 1,
      notConfigured: 0,
      failed: 0,
      domainRestricted: 0,
      messageIds: ["re_msg_1"],
    });
  });

  it("counts a skipped send separately from a delivered one", async () => {
    deps.dispatchNotification.mockResolvedValue({ email: { status: "not_configured" } });

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.summariesSent).toBe(1);
    expect(stats.email).toMatchObject({ sent: 0, notConfigured: 1, messageIds: [] });
  });

  it("separates an unverified sending domain from any other failure", async () => {
    deps.dispatchNotification.mockResolvedValue({
      email: { status: "failed", error: "please verify a domain", domainRestricted: true },
    });

    expect((await runNotificationCron(TUESDAY)).email).toMatchObject({
      sent: 0,
      failed: 1,
      domainRestricted: 1,
    });

    deps.dispatchNotification.mockResolvedValue({
      email: { status: "failed", error: "rate limit exceeded", domainRestricted: false },
    });
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));

    expect((await runNotificationCron(TUESDAY)).email).toMatchObject({
      failed: 1,
      domainRestricted: 0,
    });
  });

  it("records nothing for a dispatch that never reached the email channel", async () => {
    deps.dispatchNotification.mockResolvedValue({});

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.summariesSent).toBe(1);
    expect(stats.email).toMatchObject({ sent: 0, notConfigured: 0, failed: 0 });
  });

  it("caps the reported message ids so the response cannot grow with the user base", async () => {
    db.findMemberships.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        membership({
          userId: `user-${index}`,
          profile: { email: `member${index}@example.com`, aiProvider: "OPENAI" },
        })
      )
    );
    let counter = 0;
    deps.dispatchNotification.mockImplementation(async () => ({
      email: { status: "sent", id: `re_msg_${(counter += 1)}` },
    }));

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.email.sent).toBe(12);
    expect(stats.email.messageIds).toHaveLength(10);
  });
});

/* ------------------------------------------------------------------ */
/* Fault isolation                                                     */
/* ------------------------------------------------------------------ */

describe("runNotificationCron fault isolation", () => {
  it("counts a failing user and still processes the next one", async () => {
    db.findMemberships.mockResolvedValue([
      membership(),
      membership({
        userId: "user-2",
        profile: { email: "second@example.com", aiProvider: "OPENAI" },
        workspace: { id: "ws-2", currency: "USD" },
      }),
    ]);
    deps.getOrCreatePreferences.mockImplementation(async (userId: string) => {
      if (userId === "user-1") throw new Error("preferences unavailable");
      return prefs({ dailySummary: true });
    });

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.errors).toBe(1);
    expect(stats.users).toBe(2);
    expect(stats.summariesSent).toBe(1);
    expect(deps.generateSummary.mock.calls[0][0]).toBe("ws-2");
  });

  it("counts a failed digest without aborting the alert evaluation of other users", async () => {
    db.findMemberships.mockResolvedValue([membership()]);
    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));
    deps.generateSummary.mockRejectedValue(new Error("AI provider down"));

    const stats = await runNotificationCron(TUESDAY);
    expect(stats.errors).toBe(1);
    expect(stats.summariesSent).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The run budget                                                      */
/* ------------------------------------------------------------------ */

/**
 * The budget is wall clock, so these wait out a tiny injected one on real
 * timers instead of faking the clock: what the real run spends its budget on
 * is an AI call bounded by an `AbortSignal.timeout`, whose timer fake timers
 * do not control anyway.
 */
describe("runNotificationCron run budget", () => {
  const SLOW_USER_MS = 30;
  const TINY_BUDGET_MS = 10;

  /** Four users whose work takes long enough to blow a 10ms budget. */
  function slowUsers(): void {
    db.findMemberships.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) =>
        membership({
          userId: `user-${index}`,
          profile: { email: `member${index}@example.com`, aiProvider: "OPENAI" },
        })
      )
    );
    deps.getOrCreatePreferences.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_USER_MS));
      return prefs({ dailySummary: true });
    });
  }

  beforeEach(() => {
    slowUsers();
  });

  it("stops starting users once the budget is spent and reports how many are left", async () => {
    const stats = await runNotificationCron(TUESDAY, { budgetMs: TINY_BUDGET_MS });

    expect(stats.users).toBe(4);
    expect(stats.usersSkipped).toBe(3);
    expect(stats.summariesSent).toBe(1);
  });

  it("leaves a skipped user unclaimed, so the next run still owes them a digest", async () => {
    await runNotificationCron(TUESDAY, { budgetMs: TINY_BUDGET_MS });

    // Only the user that was actually reached had their slot claimed; the rest
    // were never looked at, so their lastDailySentAt is still null and they
    // fall due again immediately.
    const claimed = db.updatePreference.mock.calls.map(
      ([call]) => (call as { where: { userId: string } }).where.userId
    );
    expect(claimed).toEqual(["user-0"]);
    expect(deps.getOrCreatePreferences).toHaveBeenCalledTimes(1);

    deps.getOrCreatePreferences.mockResolvedValue(prefs({ dailySummary: true }));
    const next = await runNotificationCron(TUESDAY);
    expect(next.usersSkipped).toBe(0);
    expect(next.summariesSent).toBe(4);
  });

  it("finishes the user already in flight rather than abandoning a claimed slot", async () => {
    const stats = await runNotificationCron(TUESDAY, { budgetMs: TINY_BUDGET_MS });

    expect(stats.summariesSent).toBe(1);
    expect(deps.dispatchNotification).toHaveBeenCalledTimes(1);
    expect(stats.errors).toBe(0);
  });

  it("records the shortfall at warn level, so an unfinished run is not silent", async () => {
    await runNotificationCron(TUESDAY, { budgetMs: TINY_BUDGET_MS });

    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
    const warning = lines.find((line) => line.includes("ran out of budget"));
    expect(warning).toBeDefined();
    expect(JSON.parse(warning!)).toMatchObject({
      level: "warn",
      budgetMs: TINY_BUDGET_MS,
      usersProcessed: 1,
      usersSkipped: 3,
    });
  });

  it("skips nobody while the run is still inside its budget", async () => {
    const stats = await runNotificationCron(TUESDAY, { budgetMs: 60_000 });

    expect(stats.usersSkipped).toBe(0);
    expect(stats.summariesSent).toBe(4);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
