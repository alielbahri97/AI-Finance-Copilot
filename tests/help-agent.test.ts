import { describe, expect, it } from "vitest";

import { getHelpTopics } from "@/lib/help/knowledge";
import { buildHelpSystemPrompt, buildUserContextBlock, type HelpUserContext } from "@/lib/help/prompt";
import { selectTopics, tokenize } from "@/lib/help/retrieval";

const topics = getHelpTopics();

function contextFixture(overrides: Partial<HelpUserContext> = {}): HelpUserContext {
  return {
    planName: "Pro",
    integrationsEnabled: false,
    configuredProviders: ["gocardless", "slack"],
    unconfiguredProviders: ["plaid", "tink"],
    connectionStatuses: { gocardless: "CONNECTED" },
    transactionCount: 120,
    invoiceCount: 4,
    ...overrides,
  };
}

describe("help knowledge base", () => {
  it("has unique ids and non-empty content and keywords for every topic", () => {
    const ids = topics.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of topics) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.keywords.length).toBeGreaterThanOrEqual(5);
      expect(topic.content.length).toBeGreaterThan(100);
    }
  });

  it("covers the core app areas", () => {
    const ids = new Set(topics.map((topic) => topic.id));
    for (const required of [
      "getting-started",
      "csv-import",
      "categories-rules",
      "transactions",
      "copilot",
      "forecast",
      "invoices",
      "reports-exports",
      "notifications",
      "bank-connections",
      "integrations-other",
      "billing-plans",
      "settings-profile",
      "help-escalation",
    ]) {
      expect(ids.has(required), `missing topic ${required}`).toBe(true);
    }
  });

  it("reuses the GoCardless connect steps from the provider guide", () => {
    const bank = topics.find((topic) => topic.id === "bank-connections")!;
    // First user step from provider-guide.ts must appear verbatim.
    expect(bank.content).toContain("Click Connect bank and pick your country and bank.");
  });

  it("generates plan facts from the billing plans module", () => {
    const billing = topics.find((topic) => topic.id === "billing-plans")!;
    expect(billing.content).toContain("**Free**");
    expect(billing.content).toContain("1 CSV import/month");
    expect(billing.content).toContain("**Business**");
    expect(billing.content).toContain("14-day Pro trial");
  });

  it("uses only known app routes in markdown links", () => {
    const knownRoutes = new Set([
      "/dashboard", "/transactions", "/import", "/categories", "/invoices",
      "/forecast", "/reports", "/copilot", "/integrations", "/billing",
      "/profile", "/settings", "/help",
    ]);
    for (const topic of topics) {
      for (const match of topic.content.matchAll(/\]\((\/[a-z-]*)\)/g)) {
        expect(knownRoutes.has(match[1]), `${topic.id} links to unknown ${match[1]}`).toBe(true);
      }
    }
  });
});

describe("help retrieval", () => {
  it("tokenizes with stop words removed and dedupes", () => {
    expect(tokenize("How do I import the CSV, import it?")).toEqual(
      expect.arrayContaining(["import", "csv"])
    );
    expect(tokenize("How do I…?")).toHaveLength(0);
  });

  it("finds the bank topic for bank questions", () => {
    const selected = selectTopics("how do I integrate my bank?", topics);
    expect(selected.map((topic) => topic.id)).toContain("bank-connections");
  });

  it("finds the CSV topic for import questions, including word variants", () => {
    expect(selectTopics("importing csv statements", topics)[0].id).toBe("csv-import");
    expect(selectTopics("upload my bank statement file", topics).map((t) => t.id)).toContain(
      "csv-import"
    );
  });

  it("finds forecasts, notifications and billing topics", () => {
    expect(selectTopics("how do forecasts work?", topics)[0].id).toBe("forecast");
    expect(selectTopics("set up email alerts and notifications", topics)[0].id).toBe(
      "notifications"
    );
    expect(selectTopics("what does my plan include?", topics)[0].id).toBe("billing-plans");
  });

  it("falls back to general topics for unmatched questions", () => {
    const selected = selectTopics("zzz qqq xxx", topics);
    expect(selected.map((topic) => topic.id).sort()).toEqual([
      "getting-started",
      "help-escalation",
    ]);
  });

  it("returns at most the requested number of topics", () => {
    expect(selectTopics("bank csv invoice forecast report", topics, 3)).toHaveLength(3);
  });
});

describe("help system prompt", () => {
  it("includes the user context and selected topic content", () => {
    const context = contextFixture();
    const prompt = buildHelpSystemPrompt(
      selectTopics("connect my bank", topics),
      context
    );
    expect(prompt).toContain("Plan: Pro");
    expect(prompt).toContain("NOT included — needs Business plan");
    expect(prompt).toContain("gocardless (CONNECTED)");
    expect(prompt).toContain("Connecting your bank");
    expect(prompt).toContain("not the Finance Copilot");
  });

  it("describes empty states honestly", () => {
    const block = buildUserContextBlock(
      contextFixture({
        configuredProviders: [],
        connectionStatuses: {},
        transactionCount: 0,
        invoiceCount: 0,
      })
    );
    expect(block).toContain("Integrations configured on this server: none");
    expect(block).toContain("0 transactions, 0 invoices");
    expect(block).toContain("User's existing connections: none");
  });
});
