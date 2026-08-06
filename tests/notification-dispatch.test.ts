import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationPreference } from "@/generated/prisma/client";
import { dispatchNotification, type NotificationEvent } from "@/lib/notifications/dispatch";

const ORIGIN = "https://app.example.test";
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
});

afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

const db = vi.hoisted(() => ({
  createNotification: vi.fn(),
  findConnections: vi.fn(),
  updateConnection: vi.fn(),
}));
const channels = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendPushToUser: vi.fn(),
  sendSlackMessage: vi.fn(),
  sendTeamsMessage: vi.fn(),
  isEncryptionConfigured: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { create: db.createNotification },
    integrationConnection: { findMany: db.findConnections, update: db.updateConnection },
  },
}));

vi.mock("@/lib/notifications/email", () => ({ sendEmail: channels.sendEmail }));
vi.mock("@/lib/notifications/push", () => ({ sendPushToUser: channels.sendPushToUser }));
vi.mock("@/lib/integrations/crypto", () => ({
  isEncryptionConfigured: channels.isEncryptionConfigured,
  decryptSecret: channels.decryptSecret,
}));
vi.mock("@/lib/integrations/providers/slack", () => ({
  sendSlackMessage: channels.sendSlackMessage,
}));
vi.mock("@/lib/integrations/providers/teams", () => ({
  sendTeamsMessage: channels.sendTeamsMessage,
}));

const USER = { id: "user-1", email: "partner@example.com" };

function prefs(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    channelInApp: true,
    channelEmail: true,
    channelPush: true,
    ...overrides,
  } as NotificationPreference;
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    type: "LOW_CASH",
    title: "Low cash warning",
    body: "Your balance is below your floor.",
    link: "/forecast",
    emailHtml: "<p>Low cash</p>",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.createNotification.mockResolvedValue({ id: "n_1" });
  db.findConnections.mockResolvedValue([]);
  db.updateConnection.mockResolvedValue({});
  channels.sendEmail.mockResolvedValue({ status: "sent" });
  channels.sendPushToUser.mockResolvedValue(1);
  channels.sendSlackMessage.mockResolvedValue(undefined);
  channels.sendTeamsMessage.mockResolvedValue(undefined);
  channels.isEncryptionConfigured.mockReturnValue(true);
  channels.decryptSecret.mockImplementation((value: string) => `https://hooks.example/${value}`);
});

/* ------------------------------------------------------------------ */
/* Channel gating                                                      */
/* ------------------------------------------------------------------ */

describe("dispatchNotification channel gating", () => {
  it("writes the in-app record with the deep link", async () => {
    await dispatchNotification(USER, prefs({ channelEmail: false, channelPush: false }), event());

    expect(db.createNotification).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "LOW_CASH",
        title: "Low cash warning",
        body: "Your balance is below your floor.",
        link: "/forecast",
      },
    });
    expect(channels.sendEmail).not.toHaveBeenCalled();
    expect(channels.sendPushToUser).not.toHaveBeenCalled();
  });

  it("stores a null link when the event has none", async () => {
    await dispatchNotification(
      USER,
      prefs({ channelEmail: false, channelPush: false }),
      event({ link: undefined })
    );
    expect(db.createNotification.mock.calls[0][0]).toMatchObject({ data: { link: null } });
  });

  it("skips the in-app record when the user turned the channel off", async () => {
    await dispatchNotification(
      USER,
      prefs({ channelInApp: false, channelEmail: false, channelPush: false }),
      event()
    );
    expect(db.createNotification).not.toHaveBeenCalled();
  });

  it("emails the account address, tagging the channel with the event type", async () => {
    await dispatchNotification(
      USER,
      prefs({ channelPush: false }),
      event({ emailSubject: "Heads up: low cash" })
    );

    expect(channels.sendEmail).toHaveBeenCalledWith(
      "partner@example.com",
      "Heads up: low cash",
      "<p>Low cash</p>",
      "notification:low_cash"
    );
  });

  it("falls back to the notification title when no email subject is given", async () => {
    await dispatchNotification(USER, prefs({ channelPush: false }), event());
    expect(channels.sendEmail.mock.calls[0][1]).toBe("Low cash warning");
  });

  it("sends no email when the event carries no rendered HTML", async () => {
    await dispatchNotification(
      USER,
      prefs({ channelPush: false }),
      event({ emailHtml: undefined })
    );
    expect(channels.sendEmail).not.toHaveBeenCalled();
  });

  it("sends no email when the user turned the channel off", async () => {
    await dispatchNotification(USER, prefs({ channelEmail: false, channelPush: false }), event());
    expect(channels.sendEmail).not.toHaveBeenCalled();
  });

  it("pushes the event and truncates a long body to a notification-sized string", async () => {
    const long = "x".repeat(400);
    await dispatchNotification(USER, prefs({ channelEmail: false }), event({ body: long }));

    const payload = channels.sendPushToUser.mock.calls[0][1] as {
      title: string;
      body: string;
      link?: string;
    };
    expect(channels.sendPushToUser.mock.calls[0][0]).toBe("user-1");
    expect(payload.body).toHaveLength(180);
    expect(payload.body.endsWith("...")).toBe(true);
    expect(payload.link).toBe("/forecast");
  });

  it("leaves a short push body untouched", async () => {
    await dispatchNotification(USER, prefs({ channelEmail: false }), event());
    expect((channels.sendPushToUser.mock.calls[0][1] as { body: string }).body).toBe(
      "Your balance is below your floor."
    );
  });
});

/* ------------------------------------------------------------------ */
/* Best-effort channels never break the dispatch                       */
/* ------------------------------------------------------------------ */

describe("dispatchNotification failure isolation", () => {
  it("keeps going when the email provider reports a failure, and reports it back", async () => {
    channels.sendEmail.mockResolvedValue({
      status: "failed",
      error: "verify a domain",
      domainRestricted: true,
    });

    await expect(dispatchNotification(USER, prefs(), event())).resolves.toEqual({
      email: { status: "failed", error: "verify a domain", domainRestricted: true },
    });
    expect(db.createNotification).toHaveBeenCalled();
    expect(channels.sendPushToUser).toHaveBeenCalled();
  });

  it("reports a thrown email call as a failure rather than swallowing it", async () => {
    channels.sendEmail.mockRejectedValue(new Error("boom"));

    const result = await dispatchNotification(USER, prefs(), event());
    expect(result.email).toMatchObject({ status: "failed" });
    expect(channels.sendPushToUser).toHaveBeenCalled();
  });

  it("keeps going when push delivery throws", async () => {
    channels.sendPushToUser.mockRejectedValue(new Error("vapid rejected"));
    await expect(dispatchNotification(USER, prefs(), event())).resolves.toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Slack / Teams                                                       */
/* ------------------------------------------------------------------ */

describe("dispatchNotification chat channels", () => {
  const base = () => prefs({ channelEmail: false, channelPush: false });

  it("does nothing when the event names no workspace", async () => {
    await dispatchNotification(USER, base(), event());
    expect(db.findConnections).not.toHaveBeenCalled();
  });

  it("does nothing when secret encryption is not configured", async () => {
    channels.isEncryptionConfigured.mockReturnValue(false);
    await dispatchNotification(USER, base(), event({ chatWorkspaceId: "ws-1" }));
    expect(db.findConnections).not.toHaveBeenCalled();
  });

  it("posts an absolute link to every connected Slack and Teams webhook", async () => {
    db.findConnections.mockResolvedValue([
      { id: "c1", provider: "slack", accessToken: "enc-slack" },
      { id: "c2", provider: "teams", accessToken: "enc-teams" },
    ]);

    await dispatchNotification(USER, base(), event({ chatWorkspaceId: "ws-1" }));

    expect(db.findConnections).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1", status: "CONNECTED" }),
      })
    );
    expect(channels.sendSlackMessage).toHaveBeenCalledWith("https://hooks.example/enc-slack", {
      title: "Low cash warning",
      body: "Your balance is below your floor.",
      link: `${ORIGIN}/forecast`,
    });
    expect(channels.sendTeamsMessage).toHaveBeenCalledWith(
      "https://hooks.example/enc-teams",
      expect.objectContaining({ title: "Low cash warning" })
    );
  });

  it("omits the link when the event has none", async () => {
    db.findConnections.mockResolvedValue([{ id: "c1", provider: "slack", accessToken: "enc" }]);
    await dispatchNotification(
      USER,
      base(),
      event({ link: undefined, chatWorkspaceId: "ws-1" })
    );
    expect(channels.sendSlackMessage.mock.calls[0][1]).toMatchObject({ link: undefined });
  });

  it("marks a connection errored when its webhook post fails, and still posts to the rest", async () => {
    db.findConnections.mockResolvedValue([
      { id: "c1", provider: "slack", accessToken: "enc-slack" },
      { id: "c2", provider: "teams", accessToken: "enc-teams" },
    ]);
    channels.sendSlackMessage.mockRejectedValueOnce(new Error("404 no_service"));

    await dispatchNotification(USER, base(), event({ chatWorkspaceId: "ws-1" }));

    expect(db.updateConnection).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "ERROR", lastError: "404 no_service" },
    });
    expect(channels.sendTeamsMessage).toHaveBeenCalled();
  });

  it("never lets a chat failure escape the dispatch", async () => {
    db.findConnections.mockRejectedValue(new Error("db down"));
    await expect(
      dispatchNotification(USER, base(), event({ chatWorkspaceId: "ws-1" }))
    ).resolves.toEqual({});
  });
});
