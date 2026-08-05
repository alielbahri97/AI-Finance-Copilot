import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiChatMessage, AiClient } from "@/lib/ai";
import { EDITION_PLANS, getPlan } from "@/lib/billing/plans";
import {
  buildFallbackDraft,
  buildReminderPrompt,
  daysPastDue,
  DUNNING_STEPS,
  isDunnable,
  nextDunningStep,
  normalizeEmail,
  parseReminderDraft,
  selectDunningStep,
  type DunnableInvoice,
  type DunningStep,
  type ReminderFacts,
} from "@/lib/invoices/dunning-core";

/* ------------------------------------------------------------------ */
/* Mocks — the suite must run with no AI key, no mail provider and no DB */
/* ------------------------------------------------------------------ */

const ai = vi.hoisted(() => ({ getAiClient: vi.fn() }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(), renderCustomerReminderEmail: vi.fn() }));
const db = vi.hoisted(() => ({
  findInvoice: vi.fn(),
  findInvoices: vi.fn(),
  updateInvoice: vi.fn(),
  createLog: vi.fn(),
  deleteLog: vi.fn(),
  findWorkspaces: vi.fn(),
  findOwner: vi.fn(),
}));
const deps = vi.hoisted(() => ({
  getEntitlements: vi.fn(),
  dispatchNotification: vi.fn(),
  getOrCreatePreferences: vi.fn(),
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, getAiClient: ai.getAiClient };
});
vi.mock("@/lib/notifications/email", () => ({
  sendEmail: mail.sendEmail,
  renderCustomerReminderEmail: mail.renderCustomerReminderEmail,
  isEmailConfigured: () => false,
}));
vi.mock("@/lib/notifications/dispatch", () => ({
  dispatchNotification: deps.dispatchNotification,
}));
vi.mock("@/lib/notifications/preferences", () => ({
  getOrCreatePreferences: deps.getOrCreatePreferences,
}));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: deps.getEntitlements }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findFirst: db.findInvoice,
      findMany: db.findInvoices,
      update: db.updateInvoice,
    },
    reminderLog: { create: db.createLog, delete: db.deleteLog },
    workspace: { findMany: db.findWorkspaces },
    workspaceMember: { findFirst: db.findOwner },
  },
}));

const { draftReminder, runAutoDunning, sendInvoiceReminder } = await import(
  "@/lib/invoices/dunning"
);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-08-05T09:00:00Z");

/** A due date exactly `daysLate` days in the past (negative = still ahead). */
function dueDaysAgo(daysLate: number): Date {
  return new Date(Date.UTC(2026, 7, 5 - daysLate));
}

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    vendor: "ACME Coffee",
    customerEmail: "ap@acme.example",
    invoiceNumber: "INV-0042",
    dueDate: dueDaysAgo(3),
    currency: "EUR",
    total: 1250,
    direction: "RECEIVABLE" as const,
    status: "UNPAID" as const,
    workspace: { name: "Bar Ballast" },
    reminderLogs: [] as { kind: DunningStep; sentAt: Date }[],
    ...overrides,
  };
}

function facts(overrides: Partial<ReminderFacts> = {}): ReminderFacts {
  return {
    step: "OVERDUE_1",
    companyName: "Bar Ballast",
    customerName: "ACME Coffee",
    invoiceNumber: "INV-0042",
    amount: 1250,
    currency: "EUR",
    dueDate: "2026-08-02",
    daysLate: 3,
    ...overrides,
  };
}

function stubClient(reply: string): AiClient & { calls: AiChatMessage[][] } {
  const calls: AiChatMessage[][] = [];
  return {
    provider: "groq",
    model: "stub-model",
    visionModel: null,
    calls,
    async chat(messages: AiChatMessage[]) {
      calls.push(messages);
      return reply;
    },
    async *chatStream(): AsyncGenerator<string> {
      yield* [];
      throw new Error("reminders are never streamed");
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  ai.getAiClient.mockImplementation(() => {
    throw new Error("No AI provider configured.");
  });
  mail.sendEmail.mockResolvedValue({ status: "sent" });
  mail.renderCustomerReminderEmail.mockReturnValue("<html></html>");
  db.findInvoice.mockResolvedValue(invoiceRow());
  db.findInvoices.mockResolvedValue([]);
  db.updateInvoice.mockResolvedValue({});
  db.createLog.mockResolvedValue({ id: "log-1" });
  db.deleteLog.mockResolvedValue({});
  db.findWorkspaces.mockResolvedValue([]);
  db.findOwner.mockResolvedValue({
    userId: "user-1",
    profile: { email: "owner@example.com", aiProvider: "GROQ" },
  });
  deps.getEntitlements.mockResolvedValue({
    plan: { limits: { dunningEnabled: true } },
    planId: "PRO",
    edition: "business",
  });
  deps.getOrCreatePreferences.mockResolvedValue({ channelInApp: true });
  deps.dispatchNotification.mockResolvedValue(undefined);
});

/* ------------------------------------------------------------------ */
/* The escalation ladder                                               */
/* ------------------------------------------------------------------ */

describe("selectDunningStep", () => {
  it("picks the step from how late the invoice is", () => {
    expect(selectDunningStep(0)).toBe("DUE_SOON");
    expect(selectDunningStep(1)).toBe("OVERDUE_1");
    expect(selectDunningStep(14)).toBe("OVERDUE_1");
    expect(selectDunningStep(15)).toBe("OVERDUE_2");
    expect(selectDunningStep(30)).toBe("OVERDUE_2");
    expect(selectDunningStep(31)).toBe("FINAL");
  });

  it("starts a week before the due date and not a day earlier", () => {
    expect(selectDunningStep(-7)).toBe("DUE_SOON");
    expect(selectDunningStep(-8)).toBeNull();
    expect(selectDunningStep(-90)).toBeNull();
  });

  it("keeps very old invoices on the last step rather than inventing one", () => {
    expect(selectDunningStep(365)).toBe("FINAL");
    expect(DUNNING_STEPS).toEqual(["DUE_SOON", "OVERDUE_1", "OVERDUE_2", "FINAL"]);
  });
});

describe("daysPastDue", () => {
  it("counts whole calendar days, not hours", () => {
    // Due yesterday at 23:00 UTC, asked at 09:00 today: one day late, not zero.
    expect(daysPastDue(new Date("2026-08-04T23:00:00Z"), NOW)).toBe(1);
    expect(daysPastDue(new Date("2026-08-05T00:00:00Z"), NOW)).toBe(0);
    expect(daysPastDue(new Date("2026-08-06T00:00:00Z"), NOW)).toBe(-1);
  });
});

describe("nextDunningStep", () => {
  const base: DunnableInvoice = {
    direction: "RECEIVABLE",
    status: "UNPAID",
    dueDate: dueDaysAgo(3),
    customerEmail: "ap@acme.example",
  };

  it("returns the current step when it has not been sent", () => {
    expect(nextDunningStep(base, [], NOW)).toBe("OVERDUE_1");
  });

  it("never sends the same step twice", () => {
    expect(nextDunningStep(base, ["OVERDUE_1"], NOW)).toBeNull();
    expect(nextDunningStep(base, ["DUE_SOON", "OVERDUE_1"], NOW)).toBeNull();
  });

  it("moves on once the invoice reaches the next step", () => {
    const later = { ...base, dueDate: dueDaysAgo(20) };
    expect(nextDunningStep(later, ["DUE_SOON", "OVERDUE_1"], NOW)).toBe("OVERDUE_2");
  });

  it("sends only today's step after a gap, never the ones that were missed", () => {
    // Nothing was ever sent for an invoice that is now 40 days late: it gets
    // the final notice, and the three rungs below it stay unsent forever.
    const ancient = { ...base, dueDate: dueDaysAgo(40) };
    expect(nextDunningStep(ancient, [], NOW)).toBe("FINAL");
    expect(nextDunningStep(ancient, ["FINAL"], NOW)).toBeNull();
  });

  it("ignores invoices that cannot be dunned at all", () => {
    expect(nextDunningStep({ ...base, direction: "PAYABLE" }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, status: "PAID" }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, status: "DRAFT" }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, customerEmail: null }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, customerEmail: "   " }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, customerEmail: "not-an-address" }, [], NOW)).toBeNull();
    expect(nextDunningStep({ ...base, dueDate: null }, [], NOW)).toBeNull();
  });
});

describe("isDunnable", () => {
  it("is false for a bill we owe, however overdue", () => {
    expect(
      isDunnable({
        direction: "PAYABLE",
        status: "UNPAID",
        dueDate: dueDaysAgo(200),
        customerEmail: "ap@acme.example",
      })
    ).toBe(false);
  });

  it("is false without a customer address", () => {
    expect(
      isDunnable({
        direction: "RECEIVABLE",
        status: "UNPAID",
        dueDate: dueDaysAgo(2),
        customerEmail: null,
      })
    ).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("accepts a plain address and rejects the rest", () => {
    expect(normalizeEmail("  ap@acme.example  ")).toBe("ap@acme.example");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("ap@acme")).toBeNull();
    expect(normalizeEmail("ap acme@example.com")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Drafting                                                            */
/* ------------------------------------------------------------------ */

describe("buildFallbackDraft", () => {
  it("states the invoice, the amount and the due date at every step", () => {
    for (const step of DUNNING_STEPS) {
      const draft = buildFallbackDraft(facts({ step }));
      expect(draft.subject.length).toBeGreaterThan(0);
      expect(draft.body).toContain("INV-0042");
      expect(draft.body).toContain("€1,250.00");
      expect(draft.body).toContain("2 August 2026");
      expect(draft.body).toContain("Bar Ballast");
    }
  });

  it("escalates its tone with lateness", () => {
    expect(buildFallbackDraft(facts({ step: "DUE_SOON", daysLate: -2 })).body).toContain(
      "friendly reminder"
    );
    expect(buildFallbackDraft(facts({ step: "OVERDUE_2", daysLate: 20 })).subject).toContain(
      "Second reminder"
    );
    expect(buildFallbackDraft(facts({ step: "FINAL", daysLate: 45 })).subject).toContain(
      "Final reminder"
    );
  });

  it("copes with an invoice that was never numbered", () => {
    const draft = buildFallbackDraft(facts({ invoiceNumber: null }));
    expect(draft.subject).not.toContain("null");
    expect(draft.body).toMatch(/the invoice for/i);
  });
});

describe("buildReminderPrompt", () => {
  it("forbids the details a model would otherwise invent", () => {
    const prompt = buildReminderPrompt(facts(), "Ballast");
    expect(prompt.system).toMatch(/never invent bank details/i);
    expect(prompt.system).toMatch(/do not threaten legal action/i);
    expect(prompt.user).toContain("INV-0042");
    expect(prompt.user).toContain("€1,250.00");
  });
});

describe("parseReminderDraft", () => {
  it("reads the documented shape, fenced or not", () => {
    expect(parseReminderDraft('{"subject":"Pay up","body":"Hi there"}')).toEqual({
      subject: "Pay up",
      body: "Hi there",
    });
    expect(
      parseReminderDraft('```json\n{"subject":"Pay up","body":"Hi\\n\\nthere"}\n```')
    ).toEqual({ subject: "Pay up", body: "Hi\n\nthere" });
  });

  it("rejects anything unusable rather than patching it up", () => {
    expect(parseReminderDraft("not json at all")).toBeNull();
    expect(parseReminderDraft('{"subject":"","body":"x"}')).toBeNull();
    expect(parseReminderDraft('{"subject":"x"}')).toBeNull();
    expect(parseReminderDraft(`{"subject":"x","body":"${"y".repeat(4001)}"}`)).toBeNull();
  });
});

describe("draftReminder", () => {
  it("falls back to the template when no AI provider is configured", async () => {
    const draft = await draftReminder(facts());
    expect(draft.source).toBe("template");
    expect(draft.subject).toBe(buildFallbackDraft(facts()).subject);
    expect(draft.body).toContain("INV-0042");
  });

  it("uses the model's draft when it answers with one", async () => {
    ai.getAiClient.mockReturnValue(
      stubClient('{"subject":"Invoice INV-0042 is 3 days past due","body":"Hi ACME,\\n\\nPlease pay."}')
    );
    const draft = await draftReminder(facts());
    expect(draft.source).toBe("ai");
    expect(draft.subject).toBe("Invoice INV-0042 is 3 days past due");
  });

  it("falls back when the model answers with something unusable", async () => {
    ai.getAiClient.mockReturnValue(stubClient("Sure! Here is your email :)"));
    const draft = await draftReminder(facts());
    expect(draft.source).toBe("template");
  });
});

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

describe("sendInvoiceReminder", () => {
  const input = {
    workspaceId: "ws-1",
    invoiceId: "inv-1",
    toEmail: "ap@acme.example",
    subject: "Reminder",
    body: "Please pay",
    sentBy: "user-1",
    now: NOW,
  };

  it("claims the step, sends, and records who sent it", async () => {
    const result = await sendInvoiceReminder(input);
    expect(result).toMatchObject({ ok: true, step: "OVERDUE_1", logged: true });
    expect(db.createLog).toHaveBeenCalledTimes(1);
    expect(db.createLog.mock.calls[0][0].data).toMatchObject({
      invoiceId: "inv-1",
      kind: "OVERDUE_1",
      sentBy: "user-1",
    });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.deleteLog).not.toHaveBeenCalled();
  });

  it("refuses an invoice that was paid while the draft was on screen", async () => {
    db.findInvoice.mockResolvedValue(invoiceRow({ status: "PAID" }));
    expect(await sendInvoiceReminder(input)).toEqual({ ok: false, reason: "not_unpaid" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a payable, whoever asks", async () => {
    db.findInvoice.mockResolvedValue(invoiceRow({ direction: "PAYABLE" }));
    expect(await sendInvoiceReminder(input)).toEqual({ ok: false, reason: "not_dunnable" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a step that has already gone out", async () => {
    db.findInvoice.mockResolvedValue(
      invoiceRow({ reminderLogs: [{ kind: "OVERDUE_1", sentAt: NOW }] })
    );
    const result = await sendInvoiceReminder(input);
    expect(result).toMatchObject({ ok: false, reason: "already_sent", step: "OVERDUE_1" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("gives the step back when the provider did not deliver", async () => {
    mail.sendEmail.mockResolvedValue({ status: "failed", error: "nope" });
    const result = await sendInvoiceReminder(input);
    expect(result).toMatchObject({ ok: true, logged: false });
    expect(db.deleteLog).toHaveBeenCalledWith({ where: { id: "log-1" } });
    expect(db.updateInvoice).not.toHaveBeenCalled();
  });

  it("treats a lost race on the unique key as already sent", async () => {
    db.createLog.mockRejectedValue(new Error("Unique constraint failed"));
    const result = await sendInvoiceReminder(input);
    expect(result).toMatchObject({ ok: false, reason: "already_sent" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The automatic pass                                                  */
/* ------------------------------------------------------------------ */

describe("runAutoDunning", () => {
  beforeEach(() => {
    db.findWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Bar Ballast" }]);
  });

  it("does nothing at all when no workspace opted in", async () => {
    db.findWorkspaces.mockResolvedValue([]);
    expect(await runAutoDunning(NOW)).toEqual({
      workspaces: 0,
      eligible: 0,
      sent: 0,
      undelivered: 0,
      errors: 0,
    });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("skips a workspace whose plan does not include reminders", async () => {
    deps.getEntitlements.mockResolvedValue({
      plan: { limits: { dunningEnabled: false } },
      planId: "FREE",
      edition: "business",
    });
    db.findInvoices.mockResolvedValue([invoiceRow()]);
    const stats = await runAutoDunning(NOW);
    expect(stats.workspaces).toBe(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("sends one reminder and tells the owner about it", async () => {
    const row = invoiceRow();
    db.findInvoices.mockResolvedValue([row]);
    db.findInvoice.mockResolvedValue(row);

    const stats = await runAutoDunning(NOW);

    expect(stats).toMatchObject({ workspaces: 1, eligible: 1, sent: 1, undelivered: 0 });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail.mock.calls[0][0]).toBe("ap@acme.example");
    // An automatic send has no author.
    expect(db.createLog.mock.calls[0][0].data.sentBy).toBeNull();
    expect(deps.dispatchNotification).toHaveBeenCalledTimes(1);
    const event = deps.dispatchNotification.mock.calls[0][2];
    expect(event.title).toContain("ACME Coffee");
    expect(event.link).toBe("/invoices/inv-1");
  });

  it("sends at most one step per invoice, even after a long outage", async () => {
    // 40 days late, nothing ever sent: one FINAL notice, not four emails.
    const row = invoiceRow({ dueDate: dueDaysAgo(40) });
    db.findInvoices.mockResolvedValue([row]);
    db.findInvoice.mockResolvedValue(row);

    const stats = await runAutoDunning(NOW);

    expect(stats.sent).toBe(1);
    expect(db.createLog).toHaveBeenCalledTimes(1);
    expect(db.createLog.mock.calls[0][0].data.kind).toBe("FINAL");
  });

  it("is a no-op on a second run in the same window", async () => {
    const row = invoiceRow({ reminderLogs: [{ kind: "OVERDUE_1", sentAt: NOW }] });
    db.findInvoices.mockResolvedValue([row]);
    db.findInvoice.mockResolvedValue(row);

    const stats = await runAutoDunning(NOW);

    expect(stats).toMatchObject({ eligible: 0, sent: 0 });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("never picks up an invoice with no customer address", async () => {
    const row = invoiceRow({ customerEmail: "  " });
    db.findInvoices.mockResolvedValue([row]);
    db.findInvoice.mockResolvedValue(row);

    const stats = await runAutoDunning(NOW);

    expect(stats).toMatchObject({ eligible: 0, sent: 0 });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("only looks at unpaid receivables in the first place", async () => {
    db.findInvoices.mockResolvedValue([]);
    await runAutoDunning(NOW);
    expect(db.findInvoices.mock.calls[0][0].where).toMatchObject({
      workspaceId: "ws-1",
      direction: "RECEIVABLE",
      status: "UNPAID",
    });
  });

  it("counts an undelivered reminder without burning the step", async () => {
    const row = invoiceRow();
    db.findInvoices.mockResolvedValue([row]);
    db.findInvoice.mockResolvedValue(row);
    mail.sendEmail.mockResolvedValue({ status: "not_configured" });

    const stats = await runAutoDunning(NOW);

    expect(stats).toMatchObject({ eligible: 1, sent: 0, undelivered: 1 });
    expect(db.deleteLog).toHaveBeenCalledTimes(1);
    expect(deps.dispatchNotification).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Plan gating                                                         */
/* ------------------------------------------------------------------ */

describe("plan gating", () => {
  it("is off on Business Free and on from Pro upwards", () => {
    expect(getPlan("FREE", "business").limits.dunningEnabled).toBe(false);
    expect(getPlan("PRO", "business").limits.dunningEnabled).toBe(true);
    expect(getPlan("BUSINESS", "business").limits.dunningEnabled).toBe(true);
    expect(getPlan("ENTERPRISE", "business").limits.dunningEnabled).toBe(true);
  });

  it("is off on every Personal tier, which has no invoices to chase", () => {
    for (const plan of Object.values(EDITION_PLANS.personal)) {
      expect(plan.limits.dunningEnabled).toBe(false);
    }
  });
});
