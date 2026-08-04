import { beforeEach, describe, expect, it, vi } from "vitest";

import { isConfigurationError } from "@/lib/help/errors";
import {
  buildHelpMessages,
  helpMessageCreateData,
  helpRequestSchema,
  MAX_HELP_MESSAGE_LENGTH,
  previousQuestion,
  type HelpHistoryEntry,
} from "@/lib/help/thread";
import type { HelpUserContext } from "@/lib/help/prompt";

const entitlements = vi.hoisted(() => ({ get: vi.fn() }));
const db = vi.hoisted(() => ({
  findConnections: vi.fn(),
  countTransactions: vi.fn(),
  countInvoices: vi.fn(),
}));

vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: entitlements.get,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integrationConnection: { findMany: db.findConnections },
    transaction: { count: db.countTransactions },
    invoice: { count: db.countInvoices },
  },
}));

vi.mock("@/lib/integrations/crypto", () => ({ isEncryptionConfigured: () => true }));
vi.mock("@/lib/integrations/registry", () => ({
  getProviders: () => [{ id: "gocardless" }, { id: "plaid" }],
  isProviderConfigured: (provider: { id: string }) => provider.id === "gocardless",
}));

const WORKSPACE_ID = "ws-123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "123e4567-e89b-12d3-a456-426614174000";

function context(overrides: Partial<HelpUserContext> = {}): HelpUserContext {
  return {
    planName: "Pro",
    integrationsEnabled: true,
    configuredProviders: [],
    unconfiguredProviders: [],
    connectionStatuses: {},
    transactionCount: 0,
    invoiceCount: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

describe("help request validation", () => {
  it("accepts a normal question and trims it", () => {
    const parsed = helpRequestSchema.safeParse({ message: "  How do I import a CSV?  " });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.message).toBe("How do I import a CSV?");
  });

  it("rejects empty, whitespace-only, oversized and malformed payloads", () => {
    for (const body of [
      { message: "" },
      { message: "   \n\t " },
      { message: "x".repeat(MAX_HELP_MESSAGE_LENGTH + 1) },
      { message: 42 },
      { question: "wrong field" },
      null,
      "not an object",
    ]) {
      expect(helpRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("accepts a message exactly at the limit", () => {
    expect(
      helpRequestSchema.safeParse({ message: "x".repeat(MAX_HELP_MESSAGE_LENGTH) }).success
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Persistence shape                                                   */
/* ------------------------------------------------------------------ */

describe("help message persistence shape", () => {
  it("writes user-scoped rows only", () => {
    const data = helpMessageCreateData(USER_ID, "USER", "How do I connect my bank?");
    expect(data).toEqual({
      userId: USER_ID,
      role: "USER",
      content: "How do I connect my bank?",
    });
  });

  /**
   * help_messages was deliberately excluded from the 0014 workspace migration,
   * so it has no workspace_id column. Writing one would fail every insert.
   */
  it("never writes a workspace id", () => {
    for (const role of ["USER", "ASSISTANT"] as const) {
      const data = helpMessageCreateData(USER_ID, role, "text");
      expect(Object.keys(data).sort()).toEqual(["content", "role", "userId"]);
      expect(data).not.toHaveProperty("workspaceId");
    }
  });

  it("keeps the user id verbatim rather than deriving a workspace id", () => {
    expect(helpMessageCreateData(USER_ID, "USER", "hi").userId).toBe(USER_ID);
    expect(helpMessageCreateData(USER_ID, "USER", "hi").userId).not.toContain("ws-");
  });
});

/* ------------------------------------------------------------------ */
/* Conversation assembly                                               */
/* ------------------------------------------------------------------ */

describe("help conversation assembly", () => {
  const history: HelpHistoryEntry[] = [
    { role: "USER", content: "How do I import a CSV?" },
    { role: "ASSISTANT", content: "Go to Import." },
    { role: "USER", content: "Where is that page?" },
    { role: "ASSISTANT", content: "In the sidebar." },
  ];

  it("finds the most recent question so follow-ups keep their subject", () => {
    expect(previousQuestion(history)).toBe("Where is that page?");
    expect(previousQuestion([])).toBe("");
    expect(previousQuestion([{ role: "ASSISTANT", content: "hello" }])).toBe("");
  });

  it("does not mutate the history it reads", () => {
    const copy = [...history];
    previousQuestion(history);
    expect(history).toEqual(copy);
  });

  it("puts the system prompt first, then the turns, then the new question", () => {
    const messages = buildHelpMessages([], context(), history, "And how do I undo it?");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Plan: Pro");
    expect(messages.slice(1, -1).map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.at(-1)).toEqual({ role: "user", content: "And how do I undo it?" });
  });
});

/* ------------------------------------------------------------------ */
/* Workspace-scoped situational context                                */
/* ------------------------------------------------------------------ */

describe("help user context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entitlements.get.mockResolvedValue({
      plan: { name: "Business", limits: { integrationsEnabled: true } },
    });
    db.findConnections.mockResolvedValue([{ provider: "gocardless", status: "CONNECTED" }]);
    db.countTransactions.mockResolvedValue(42);
    db.countInvoices.mockResolvedValue(7);
  });

  /**
   * The regression: the route used to pass the Supabase user id here. Billing
   * and business tables are keyed by workspace id ("ws-<userId>"), so every
   * lookup missed and the subscription upsert hit a foreign-key violation,
   * failing the whole request before a single token was streamed.
   */
  it("queries billing and business tables by workspace id", async () => {
    const { buildHelpUserContext } = await import("@/lib/help/context");
    const result = await buildHelpUserContext(WORKSPACE_ID);

    expect(entitlements.get).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(db.findConnections).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } })
    );
    expect(db.countTransactions).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
    expect(db.countInvoices).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });

    expect(result.planName).toBe("Business");
    expect(result.transactionCount).toBe(42);
    expect(result.invoiceCount).toBe(7);
    expect(result.connectionStatuses).toEqual({ gocardless: "CONNECTED" });
  });

  it("still reports server-side integration configuration without a workspace", async () => {
    const { buildHelpUserContext } = await import("@/lib/help/context");
    const result = await buildHelpUserContext(null);

    expect(entitlements.get).not.toHaveBeenCalled();
    expect(result.configuredProviders).toEqual(["gocardless"]);
    expect(result.unconfiguredProviders).toEqual(["plaid"]);
    expect(result.planName).toBe("unknown");
    expect(result.transactionCount).toBe(0);
  });

  /**
   * The help agent is what users reach for when something else is broken, so a
   * failing lookup must degrade the prompt rather than fail the request.
   */
  it("answers without workspace facts when the lookup fails", async () => {
    entitlements.get.mockRejectedValue(new Error("Foreign key constraint failed"));
    const { buildHelpUserContext } = await import("@/lib/help/context");

    const result = await buildHelpUserContext(WORKSPACE_ID);
    expect(result.planName).toBe("unknown");
    expect(result.configuredProviders).toEqual(["gocardless"]);
  });

  it("survives a database outage during the counts", async () => {
    db.countTransactions.mockRejectedValue(new Error("Can't reach database server"));
    const { buildHelpUserContext } = await import("@/lib/help/context");

    await expect(buildHelpUserContext(WORKSPACE_ID)).resolves.toMatchObject({
      transactionCount: 0,
      invoiceCount: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Error presentation                                                  */
/* ------------------------------------------------------------------ */

describe("help error presentation", () => {
  it("flags server misconfiguration so the user is not blamed", () => {
    for (const message of [
      "Groq rejected the API key. Check GROQ_API_KEY in your environment.",
      'Groq no longer serves the model "llama-3.3-70b-versatile" — set GROQ_MODEL to a current model id.',
      "No AI provider configured. Set GROQ_API_KEY (free), OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
    ]) {
      expect(isConfigurationError(message), message).toBe(true);
    }
  });

  it("treats transient failures as ordinary errors worth retrying", () => {
    for (const message of [
      "Groq is rate-limiting requests. Wait a moment and try again.",
      "The database is not reachable right now. Please try again in a moment.",
      "Could not reach the help assistant. Check your connection and try again.",
    ]) {
      expect(isConfigurationError(message), message).toBe(false);
    }
  });
});
