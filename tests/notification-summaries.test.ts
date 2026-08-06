import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiChatMessage, AiChatOptions, AiClient } from "@/lib/ai";
import type { ForecastResult } from "@/lib/finance/forecast";
import { CRON_RUN_BUDGET_MS } from "@/lib/notifications/schedule";
import { generateSummary, SUMMARY_AI_TIMEOUT_MS } from "@/lib/notifications/summaries";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

const db = vi.hoisted(() => ({ findTransactions: vi.fn() }));
const deps = vi.hoisted(() => ({
  buildForecast: vi.fn(),
  buildFinancialSnapshot: vi.fn(),
  renderSnapshot: vi.fn(),
  getAiClient: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: db.findTransactions } },
}));
vi.mock("@/lib/finance/data", () => ({ buildForecast: deps.buildForecast }));
vi.mock("@/lib/ai/context", () => ({
  buildFinancialSnapshot: deps.buildFinancialSnapshot,
  renderSnapshot: deps.renderSnapshot,
}));
vi.mock("@/lib/ai", () => ({
  getAiClient: deps.getAiClient,
  providerFromProfile: () => "groq",
}));

const PROFILE = { currency: "EUR", aiProvider: "GROQ" as const };

/**
 * A EUR workspace reads "1.200,00 €", not "€1,200.00". Built through the same
 * helper the digest uses rather than written out, because the separator ICU
 * puts before the symbol is a no-break space that varies by ICU version.
 */
const euros = (value: number) =>
  formatCurrency(value, PROFILE.currency, localeForCurrency(PROFILE.currency));

/** The real timeout is seconds long; tests inject a budget they can wait out. */
const TEST_TIMEOUT_MS = 20;

const ROWS = [
  {
    type: "INCOME",
    amount: 3000,
    description: "SALARY JULY",
    counterparty: "Acme BV",
    category: { name: "Salary" },
  },
  {
    type: "EXPENSE",
    amount: 1200,
    description: "RENT AUGUST",
    counterparty: "Landlord BV",
    category: { name: "Housing" },
  },
];

function forecast(): ForecastResult {
  return {
    currentBalance: 4200,
    metrics: { runwayMonths: 6.2, projectedBalance30d: 3800 },
    upcomingBills: [{ label: "Rent", amount: 1200, dueDate: "2026-08-01" }],
  } as unknown as ForecastResult;
}

interface StubClient extends AiClient {
  calls: { messages: AiChatMessage[]; options?: AiChatOptions }[];
}

function stubClient(chat: NonNullable<AiClient["chat"]>): StubClient {
  const calls: StubClient["calls"] = [];
  return {
    provider: "groq",
    model: "stub-model",
    visionModel: null,
    calls,
    async chat(messages, options) {
      calls.push({ messages, options });
      return chat(messages, options);
    },
    async *chatStream(): AsyncGenerator<string> {
      yield* [];
      throw new Error("the digest writer never streams");
    },
  };
}

/** Answers straight away, like a healthy provider. */
function answeringClient(reply: string): StubClient {
  return stubClient(async () => reply);
}

/**
 * Models an unreachable provider: the request stays in flight until the
 * caller's signal aborts it, which is exactly how fetch behaves. Without a
 * signal it never settles at all — the bug this guards against.
 */
function hangingClient(): StubClient {
  return stubClient(
    (_messages, options) =>
      new Promise<string>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), {
          once: true,
        });
      })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.findTransactions.mockResolvedValue(ROWS);
  deps.buildForecast.mockResolvedValue(forecast());
  deps.buildFinancialSnapshot.mockResolvedValue({ currency: "EUR" });
  deps.renderSnapshot.mockReturnValue("SNAPSHOT");
});

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

describe("generateSummary with a responsive provider", () => {
  it("uses the AI reply as the digest body", async () => {
    deps.getAiClient.mockReturnValue(answeringClient("  A tidy month.  "));

    const digest = await generateSummary("ws-1", PROFILE, "daily");

    expect(digest.body).toBe("A tidy month.");
    expect(digest.type).toBe("DAILY_SUMMARY");
    expect(digest.title).toBe("Your daily financial summary");
  });

  it("gives the AI call an unexpired abort signal to hang the timeout on", async () => {
    const client = answeringClient("Fine.");
    deps.getAiClient.mockReturnValue(client);

    await generateSummary("ws-1", PROFILE, "weekly");

    const { options } = client.calls[0];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(false);
  });

  it("falls back when the provider answers with nothing usable", async () => {
    deps.getAiClient.mockReturnValue(answeringClient("   "));

    const digest = await generateSummary("ws-1", PROFILE, "daily");

    expect(digest.body).toContain("you recorded 2 transactions");
  });
});

/* ------------------------------------------------------------------ */
/* The timeout                                                         */
/* ------------------------------------------------------------------ */

describe("generateSummary when the provider hangs", () => {
  beforeEach(() => {
    deps.getAiClient.mockReturnValue(hangingClient());
  });

  it("gives up on the AI and writes the deterministic body instead", async () => {
    const digest = await generateSummary("ws-1", PROFILE, "daily", {
      timeoutMs: TEST_TIMEOUT_MS,
    });

    expect(digest.body).toContain("In the last 24 hours you recorded 2 transactions");
    expect(digest.body).toContain(
      `${euros(3000)} in, ${euros(1200)} out (net ${euros(1800)})`
    );
    expect(digest.body).toContain(`- Landlord BV (Housing): ${euros(1200)}`);
    expect(digest.body).toContain(`Upcoming bills: Rent: ${euros(1200)} due 2026-08-01.`);
    expect(digest.body).toContain("6.2 months of runway");
    // Not the en-US default: the workspace currency picks the locale.
    expect(digest.body).not.toContain("€3,000.00");
  });

  it("aborts the in-flight request rather than leaving it pending", async () => {
    const client = hangingClient();
    deps.getAiClient.mockReturnValue(client);

    await generateSummary("ws-1", PROFILE, "daily", { timeoutMs: TEST_TIMEOUT_MS });

    const signal = client.calls[0].options?.signal;
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error).name).toBe("TimeoutError");
  });

  it("resolves a complete digest, so the notification is still dispatchable", async () => {
    const digest = await generateSummary("ws-1", PROFILE, "monthly", {
      timeoutMs: TEST_TIMEOUT_MS,
    });

    expect(digest.type).toBe("MONTHLY_SUMMARY");
    expect(digest.title).toBe("Your monthly financial summary");
    expect(digest.periodLabel).toContain("Covering the last 30 days");
    expect(digest.body.length).toBeGreaterThan(0);
    expect(digest.stats).toEqual([
      { label: "Income", value: euros(3000) },
      { label: "Expenses", value: euros(1200) },
      { label: "Net", value: euros(1800) },
      { label: "Balance", value: euros(4200) },
    ]);
  });

  it("records the timeout at info level, so the degradation is not silent", async () => {
    await generateSummary("ws-1", PROFILE, "daily", { timeoutMs: TEST_TIMEOUT_MS });

    const lines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    const fallback = lines.find((line) => line.includes("using deterministic fallback"));
    expect(fallback).toBeDefined();
    expect(JSON.parse(fallback!)).toMatchObject({ level: "info", timedOut: true });
    expect(console.error).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The budget the default timeout has to fit in                         */
/* ------------------------------------------------------------------ */

describe("SUMMARY_AI_TIMEOUT_MS", () => {
  it("leaves a realistic user base room to finish inside one cron invocation", () => {
    // Even with every provider call hanging, 30 users must still be reached
    // before the run stops starting new ones.
    expect(SUMMARY_AI_TIMEOUT_MS * 30).toBeLessThan(CRON_RUN_BUDGET_MS);
  });

  it("stays long enough for a provider to write a short digest", () => {
    expect(SUMMARY_AI_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});
