import { describe, expect, it, vi } from "vitest";

import type { AiChatMessage, AiClient } from "@/lib/ai";
import {
  buildCategorizationPrompt,
  categorizationBudget,
  CATEGORIZATION_CONFIDENCE_THRESHOLD,
  extractFirstJsonBlock,
  MAX_PROMPT_CATEGORIES,
  parseCategorizationOutput,
  selectConfidentAssignments,
  selectPromptCategories,
  type CategorizableTransaction,
  type PromptCategory,
} from "@/lib/ai/categorize-core";
import { categorizeTransactionBatch } from "@/lib/ai/categorize";
import { EDITION_PLANS, getPlan } from "@/lib/billing/plans";
import { loadRuleMatchers, matchCategory, type RuleMatcher } from "@/lib/categories";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CATEGORIES: PromptCategory[] = [
  { id: "cat-groceries", name: "Groceries", type: "EXPENSE", usage: 120 },
  { id: "cat-transport", name: "Transport", type: "EXPENSE", usage: 60 },
  { id: "cat-salary", name: "Salary", type: "INCOME", usage: 12 },
];

const TRANSACTIONS: CategorizableTransaction[] = [
  {
    date: "2026-07-02",
    description: "ALBERT HEIJN 1234",
    counterparty: "Albert Heijn",
    amount: 42.15,
    type: "EXPENSE",
  },
  {
    date: "2026-07-03",
    description: "SHELL STATION A12",
    counterparty: null,
    amount: 61,
    type: "EXPENSE",
  },
  {
    date: "2026-07-25",
    description: "SALARY JULY",
    counterparty: "Acme BV",
    amount: 3200,
    type: "INCOME",
  },
];

function context(overrides: { threshold?: number } = {}) {
  return {
    transactions: TRANSACTIONS,
    categories: new Map(CATEGORIES.map((category) => [category.id, category.type])),
    ...overrides,
  };
}

/**
 * A stub AI client that replays canned replies. The suite must run without
 * any provider key, so nothing here ever reaches the network.
 */
function stubClient(replies: string[]): AiClient & { calls: AiChatMessage[][] } {
  const calls: AiChatMessage[][] = [];
  let index = 0;
  return {
    provider: "groq",
    model: "stub-model",
    visionModel: null,
    calls,
    async chat(messages: AiChatMessage[]) {
      calls.push(messages);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      if (reply === undefined) throw new Error("stub client ran out of replies");
      return reply;
    },
    async *chatStream(): AsyncGenerator<string> {
      yield* [];
      throw new Error("the categorizer never streams");
    },
  };
}

function reply(
  suggestions: { transactionIndex: number; categoryId: string; confidence: number }[]
): string {
  return JSON.stringify({ suggestions });
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

describe("categorization prompt", () => {
  it("offers ids, names and directions, and numbers the transactions", () => {
    const prompt = buildCategorizationPrompt(TRANSACTIONS, CATEGORIES);

    expect(prompt).toContain("cat-groceries — Groceries (EXPENSE)");
    expect(prompt).toContain("0. 2026-07-02 | EXPENSE | 42.15 | \"ALBERT HEIJN 1234\"");
    expect(prompt).toContain('counterparty: "Albert Heijn"');
    // Index 1 has no counterparty, so the field is simply absent.
    expect(prompt).toContain('1. 2026-07-03 | EXPENSE | 61.00 | "SHELL STATION A12"\n');
  });

  it("caps a sprawling category list at the most-used 60", () => {
    const many: PromptCategory[] = Array.from({ length: 140 }, (_, index) => ({
      id: `cat-${index}`,
      name: `Category ${index}`,
      type: "EXPENSE" as const,
      usage: index,
    }));

    const selected = selectPromptCategories(many);

    expect(selected).toHaveLength(MAX_PROMPT_CATEGORIES);
    expect(selected[0].id).toBe("cat-139");
    expect(selected.at(-1)?.id).toBe("cat-80");
  });

  it("keeps unused categories in a small workspace", () => {
    const selected = selectPromptCategories([
      { id: "a", name: "Zebra", type: "EXPENSE" },
      { id: "b", name: "Apple", type: "EXPENSE" },
    ]);

    expect(selected.map((category) => category.id)).toEqual(["b", "a"]);
  });
});

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

describe("parseCategorizationOutput", () => {
  it("parses the documented shape", () => {
    const parsed = parseCategorizationOutput(
      reply([{ transactionIndex: 0, categoryId: "cat-groceries", confidence: 0.94 }])
    );

    expect(parsed).toEqual({
      ok: true,
      suggestions: [{ transactionIndex: 0, categoryId: "cat-groceries", confidence: 0.94 }],
    });
  });

  it("survives markdown fences and chatty preambles", () => {
    const raw = `Sure! Here are the categories:\n\`\`\`json\n${reply([
      { transactionIndex: 1, categoryId: "cat-transport", confidence: 0.9 },
    ])}\n\`\`\`\nLet me know if you need anything else.`;

    const parsed = parseCategorizationOutput(raw);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.suggestions[0].categoryId).toBe("cat-transport");
  });

  it("accepts a bare array, which models return often enough to matter", () => {
    const parsed = parseCategorizationOutput(
      `[{"transactionIndex": 2, "categoryId": "cat-salary", "confidence": 1}]`
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.suggestions).toHaveLength(1);
  });

  it("recovers from trailing commas", () => {
    const parsed = parseCategorizationOutput(
      `{"suggestions": [{"transactionIndex": 0, "categoryId": "cat-groceries", "confidence": 0.9},]}`
    );

    expect(parsed.ok).toBe(true);
  });

  it("reports malformed JSON instead of throwing", () => {
    const parsed = parseCategorizationOutput(`{"suggestions": [{"transactionIndex": 0,`);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBeTruthy();
  });

  it("reports a reply with no JSON at all", () => {
    const parsed = parseCategorizationOutput("I'm sorry, I can't help with that.");

    expect(parsed).toEqual({ ok: false, error: "No JSON object found in the response." });
  });

  it("rejects entries that are not suggestions", () => {
    const parsed = parseCategorizationOutput(
      `{"suggestions": [{"transactionIndex": -4, "categoryId": "", "confidence": 7}]}`
    );

    expect(parsed.ok).toBe(false);
  });
});

describe("extractFirstJsonBlock", () => {
  it("returns the whole array rather than its first element", () => {
    expect(extractFirstJsonBlock('prose [{"a": 1}, {"b": 2}] more')).toBe(
      '[{"a": 1}, {"b": 2}]'
    );
  });

  it("ignores braces inside strings", () => {
    expect(extractFirstJsonBlock('{"description": "PAY {NOT JSON}"}')).toBe(
      '{"description": "PAY {NOT JSON}"}'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Applying suggestions                                                */
/* ------------------------------------------------------------------ */

describe("selectConfidentAssignments", () => {
  it("applies confident suggestions", () => {
    const assignments = selectConfidentAssignments(
      [
        { transactionIndex: 0, categoryId: "cat-groceries", confidence: 0.95 },
        { transactionIndex: 2, categoryId: "cat-salary", confidence: 0.8 },
      ],
      context()
    );

    expect([...assignments]).toEqual([
      [0, "cat-groceries"],
      [2, "cat-salary"],
    ]);
  });

  it("drops anything below the confidence threshold", () => {
    const justUnder = CATEGORIZATION_CONFIDENCE_THRESHOLD - 0.01;
    const assignments = selectConfidentAssignments(
      [{ transactionIndex: 0, categoryId: "cat-groceries", confidence: justUnder }],
      context()
    );

    expect(assignments.size).toBe(0);
  });

  it("drops hallucinated category ids", () => {
    const assignments = selectConfidentAssignments(
      [
        { transactionIndex: 0, categoryId: "cat-does-not-exist", confidence: 1 },
        { transactionIndex: 1, categoryId: "Transport", confidence: 1 },
      ],
      context()
    );

    expect(assignments.size).toBe(0);
  });

  it("recovers when the model returns a known category name instead of an id", () => {
    const assignments = selectConfidentAssignments(
      [{ transactionIndex: 0, categoryId: "Groceries", confidence: 0.95 }],
      {
        ...context(),
        categoryNames: new Map([["groceries", "cat-groceries"]]),
      }
    );

    expect(assignments.get(0)).toBe("cat-groceries");
  });

  it("drops indexes that were never sent", () => {
    const assignments = selectConfidentAssignments(
      [{ transactionIndex: 99, categoryId: "cat-groceries", confidence: 1 }],
      context()
    );

    expect(assignments.size).toBe(0);
  });

  it("refuses a category that points the wrong way for the transaction", () => {
    const assignments = selectConfidentAssignments(
      [{ transactionIndex: 0, categoryId: "cat-salary", confidence: 1 }],
      context()
    );

    expect(assignments.size).toBe(0);
  });

  it("keeps the first suggestion when the model repeats an index", () => {
    const assignments = selectConfidentAssignments(
      [
        { transactionIndex: 1, categoryId: "cat-transport", confidence: 0.9 },
        { transactionIndex: 1, categoryId: "cat-groceries", confidence: 0.99 },
      ],
      context()
    );

    expect(assignments.get(1)).toBe("cat-transport");
  });
});

/* ------------------------------------------------------------------ */
/* The batch runner                                                    */
/* ------------------------------------------------------------------ */

describe("categorizeTransactionBatch", () => {
  it("asks once when the first reply is usable", async () => {
    const ai = stubClient([
      reply([{ transactionIndex: 0, categoryId: "cat-groceries", confidence: 0.93 }]),
    ]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, CATEGORIES);

    expect(ai.calls).toHaveLength(1);
    expect(outcome.failureReason).toBeNull();
    expect(outcome.assignments.get(0)).toBe("cat-groceries");
  });

  it("retries once with the validation error, then succeeds", async () => {
    const ai = stubClient([
      "not json at all",
      reply([{ transactionIndex: 1, categoryId: "cat-transport", confidence: 0.88 }]),
    ]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, CATEGORIES);

    expect(ai.calls).toHaveLength(2);
    const retry = ai.calls[1];
    expect(retry).toHaveLength(4);
    expect(String(retry[3].content)).toContain("That response was rejected");
    expect(outcome.assignments.get(1)).toBe("cat-transport");
  });

  it("gives up after one retry and leaves the rows alone", async () => {
    const ai = stubClient(["still not json", "and still not json"]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, CATEGORIES);

    expect(ai.calls).toHaveLength(2);
    expect(outcome.assignments.size).toBe(0);
    expect(outcome.failureReason).toBeTruthy();
  });

  it("does not call the AI at all when the workspace has no categories", async () => {
    const ai = stubClient([reply([])]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, []);

    expect(ai.calls).toHaveLength(0);
    expect(outcome.assignments.size).toBe(0);
  });

  it("ignores a hallucinated id even when the model is certain", async () => {
    const ai = stubClient([
      reply([{ transactionIndex: 0, categoryId: "InventedCategory", confidence: 1 }]),
    ]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, CATEGORIES);

    expect(outcome.assignments.size).toBe(0);
    expect(outcome.failureReason).toBeNull();
  });

  it("accepts a category name that matches the prompt list", async () => {
    const ai = stubClient([
      reply([{ transactionIndex: 0, categoryId: "Groceries", confidence: 0.95 }]),
    ]);

    const outcome = await categorizeTransactionBatch(ai, TRANSACTIONS, CATEGORIES);

    expect(outcome.assignments.get(0)).toBe("cat-groceries");
  });
});

/* ------------------------------------------------------------------ */
/* Precedence: a rule always beats the AI                              */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    categoryRule: {
      findMany: vi.fn(async () => [
        { pattern: "shell", categoryId: "cat-transport" },
        { pattern: "albert heijn", categoryId: "cat-groceries" },
      ]),
    },
  },
}));

describe("rules take precedence over the AI", () => {
  it("only offers the AI the rows no rule matched", async () => {
    const matchers: RuleMatcher[] = await loadRuleMatchers("ws-1");

    const uncategorized = TRANSACTIONS.filter(
      (transaction) =>
        matchCategory(matchers, transaction.description, transaction.counterparty) === null
    );

    // Groceries and Transport were claimed by rules; only the salary is left.
    expect(uncategorized.map((transaction) => transaction.description)).toEqual([
      "SALARY JULY",
    ]);
  });

  it("keeps the rule's category even when the AI is confident about another", async () => {
    const matchers = await loadRuleMatchers("ws-1");
    const shell = TRANSACTIONS[1];
    const ruleCategory = matchCategory(matchers, shell.description, shell.counterparty);

    // The pipeline only ever hands over rows the rules left alone, so the
    // batch simply does not contain Shell and the AI is never asked.
    const sent = TRANSACTIONS.filter(
      (transaction) =>
        matchCategory(matchers, transaction.description, transaction.counterparty) === null
    );
    const ai = stubClient([
      reply([{ transactionIndex: 0, categoryId: "cat-salary", confidence: 1 }]),
    ]);
    const outcome = await categorizeTransactionBatch(ai, sent, CATEGORIES);

    expect(ruleCategory).toBe("cat-transport");
    expect(sent).not.toContain(shell);
    expect([...outcome.assignments.values()]).toEqual(["cat-salary"]);
  });
});

/* ------------------------------------------------------------------ */
/* Quota                                                               */
/* ------------------------------------------------------------------ */

describe("categorizationBudget", () => {
  it("treats a null limit as unlimited", () => {
    expect(categorizationBudget(null, 9_999, 50)).toEqual({
      allowed: 50,
      limitReached: false,
      remaining: null,
    });
  });

  it("allows the whole request while there is room", () => {
    expect(categorizationBudget(100, 40, 50)).toEqual({
      allowed: 50,
      limitReached: false,
      remaining: 10,
    });
  });

  it("spends what is left and reports the shortfall", () => {
    expect(categorizationBudget(100, 80, 50)).toEqual({
      allowed: 20,
      limitReached: true,
      remaining: 0,
    });
  });

  it("allows nothing once the allowance is used up", () => {
    expect(categorizationBudget(100, 100, 30)).toEqual({
      allowed: 0,
      limitReached: true,
      remaining: 0,
    });
  });

  it("does not go negative when usage somehow overshot the limit", () => {
    expect(categorizationBudget(100, 140, 10)).toEqual({
      allowed: 0,
      limitReached: true,
      remaining: 0,
    });
  });
});

describe("plan limits", () => {
  it("gives both editions' Free tier a 100-row monthly taste", () => {
    expect(getPlan("FREE", "business").limits.aiCategorizationPerMonth).toBe(100);
    expect(getPlan("FREE", "personal").limits.aiCategorizationPerMonth).toBe(100);
  });

  it("leaves every paid tier unlimited", () => {
    for (const [edition, plans] of Object.entries(EDITION_PLANS)) {
      for (const [planId, plan] of Object.entries(plans)) {
        if (planId === "FREE") continue;
        expect(
          plan?.limits.aiCategorizationPerMonth,
          `${edition} ${planId} should be unlimited`
        ).toBeNull();
      }
    }
  });
});
