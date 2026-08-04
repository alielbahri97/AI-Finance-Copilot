import { describe, expect, it } from "vitest";

import { getHelpTopics } from "@/lib/help/knowledge";
import { buildHelpSystemPrompt, buildUserContextBlock, type HelpUserContext } from "@/lib/help/prompt";
import { selectTopics, tokenize } from "@/lib/help/retrieval";

const topics = getHelpTopics();
const personalTopics = getHelpTopics("personal");

function contextFixture(overrides: Partial<HelpUserContext> = {}): HelpUserContext {
  return {
    edition: "business",
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
      "/profile", "/settings", "/help", "/budgets", "/goals", "/subscriptions",
    ]);
    for (const topic of [...topics, ...personalTopics]) {
      for (const match of topic.content.matchAll(/\]\((\/[a-z-]*)\)/g)) {
        expect(knownRoutes.has(match[1]), `${topic.id} links to unknown ${match[1]}`).toBe(true);
      }
    }
  });
});

describe("help knowledge base per edition", () => {
  it("defaults to the Business edition", () => {
    expect(topics.map((topic) => topic.id)).toEqual(
      getHelpTopics("business").map((topic) => topic.id)
    );
  });

  it("adds the personal topics and drops the business-only ones", () => {
    const ids = new Set(personalTopics.map((topic) => topic.id));
    for (const required of ["budgets", "goals", "subscriptions"]) {
      expect(ids.has(required), `missing personal topic ${required}`).toBe(true);
    }
    for (const absent of ["invoices", "team-invitations"]) {
      expect(ids.has(absent), `personal edition must not document ${absent}`).toBe(false);
    }
    // The shared core is documented in both.
    for (const shared of ["csv-import", "forecast", "reports-exports", "bank-connections"]) {
      expect(ids.has(shared), `missing shared topic ${shared}`).toBe(true);
    }
  });

  it("never mentions a business-only surface to a personal workspace", () => {
    const forbidden = [/\/invoices/, /\bVAT\b/, /\bvendors?\b/i, /invite/i, /\bseats?\b/i];
    // The workspaces topic is the one place that names the other edition, so
    // someone asking "can I also track my company here?" gets a real answer.
    for (const topic of personalTopics.filter((entry) => entry.id !== "workspaces")) {
      for (const pattern of forbidden) {
        expect(pattern.test(topic.content), `${topic.id} mentions ${pattern}`).toBe(false);
      }
    }
  });

  it("generates the personal tier facts from the plans module", () => {
    const billing = personalTopics.find((topic) => topic.id === "billing-plans")!;
    expect(billing.content).toContain("**Plus** (€4.99/month)");
    expect(billing.content).toContain("**Premium** (€8.99/month)");
    expect(billing.content).toContain("14-day Plus trial");
    expect(billing.content).not.toContain("**Enterprise**");
    // Free allows one bank on Personal, and budgets on every tier.
    expect(billing.content).toContain("1 bank connection");
    expect(billing.content).toContain("budgets");
  });

  it("states the real plan gate for goals and subscription insights", () => {
    const goals = personalTopics.find((topic) => topic.id === "goals")!;
    const subscriptions = personalTopics.find((topic) => topic.id === "subscriptions")!;
    expect(goals.content).toContain("the Plus plan or higher");
    expect(subscriptions.content).toContain("the Plus plan or higher");
    const budgets = personalTopics.find((topic) => topic.id === "budgets")!;
    expect(budgets.content).toContain("every plan");
  });

  it("retrieves the personal topics for personal questions", () => {
    expect(selectTopics("how do budgets work?", personalTopics)[0].id).toBe("budgets");
    expect(selectTopics("saving for a house deposit", personalTopics)[0].id).toBe("goals");
    expect(selectTopics("what subscriptions am I paying for", personalTopics)[0].id).toBe(
      "subscriptions"
    );
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
