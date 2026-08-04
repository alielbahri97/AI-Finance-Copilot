import { beforeEach, describe, expect, it, vi } from "vitest";

const categoryCount = vi.fn();
const categoryCreateMany = vi.fn();
const categoryFindMany = vi.fn();
const categoryRuleCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      count: (...args: unknown[]) => categoryCount(...args),
      createMany: (...args: unknown[]) => categoryCreateMany(...args),
      findMany: (...args: unknown[]) => categoryFindMany(...args),
    },
    categoryRule: {
      createMany: (...args: unknown[]) => categoryRuleCreateMany(...args),
    },
  },
}));

import {
  compactCategoryPattern,
  DEFAULT_CATEGORY_RULES,
  ensureDefaultCategories,
  extractCategoryPattern,
  matchCategory,
  normalizeCategoryPattern,
  type RuleMatcher,
} from "@/lib/categories";

describe("normalizeCategoryPattern", () => {
  it("lowercases and strips digits and punctuation", () => {
    expect(normalizeCategoryPattern("Albert Heijn #123")).toBe("albert heijn");
    expect(normalizeCategoryPattern("UBER *TRIP 8842")).toBe("uber trip");
  });

  it("returns empty for blank input", () => {
    expect(normalizeCategoryPattern("   ")).toBe("");
    expect(normalizeCategoryPattern("999")).toBe("");
  });
});

describe("compactCategoryPattern", () => {
  it("strips payment noise and stopwords", () => {
    expect(compactCategoryPattern("card payment to netflix")).toBe("netflix");
  });
});

describe("extractCategoryPattern", () => {
  it("prefers counterparty over description", () => {
    expect(extractCategoryPattern("POS PURCHASE 1234", "Spotify AB")).toBe("spotify ab");
    expect(extractCategoryPattern("Weekly shop", "Albert Heijn")).toBe("albert heijn");
  });

  it("strips noise words from descriptions", () => {
    expect(extractCategoryPattern("Card payment to Netflix", null)).toBe("netflix");
  });

  it("rejects empty and noisy one-offs", () => {
    expect(extractCategoryPattern("to", null)).toBeNull();
    expect(extractCategoryPattern("", null)).toBeNull();
    expect(extractCategoryPattern("Payment", null)).toBeNull();
    expect(extractCategoryPattern("Card payment", "Transfer")).toBeNull();
    expect(extractCategoryPattern("ATM Withdrawal 50", null)).toBeNull();
    expect(extractCategoryPattern("SEPA", "")).toBeNull();
  });

  it("keeps meaningful merchant keywords", () => {
    expect(extractCategoryPattern("Payment to Spotify", "Spotify AB")).toBe("spotify ab");
    expect(extractCategoryPattern("Shell Station A12", null)).toBe("shell station");
  });
});

describe("matchCategory", () => {
  const matchers: RuleMatcher[] = [
    { pattern: "albert heijn", categoryId: "groceries" },
    { pattern: "netflix", categoryId: "subs" },
    { pattern: "shell", categoryId: "transport" },
  ].sort((a, b) => b.pattern.length - a.pattern.length);

  it("matches description or counterparty case-insensitively", () => {
    expect(matchCategory(matchers, "AH purchase", "Albert Heijn Amsterdam")).toBe("groceries");
    expect(matchCategory(matchers, "NETFLIX.COM", null)).toBe("subs");
  });

  it("prefers the longest matching pattern", () => {
    const longerFirst: RuleMatcher[] = [
      { pattern: "spotify premium", categoryId: "subs" },
      { pattern: "spotify", categoryId: "music" },
    ].sort((a, b) => b.pattern.length - a.pattern.length);

    expect(matchCategory(longerFirst, "SPOTIFY PREMIUM SE", null)).toBe("subs");
    expect(matchCategory(longerFirst, "Spotify", "Spotify")).toBe("music");
  });

  it("returns null when nothing matches", () => {
    expect(matchCategory(matchers, "Random coffee", "Local Cafe")).toBeNull();
  });
});

describe("ensureDefaultCategories rule backfill", () => {
  beforeEach(() => {
    categoryCount.mockReset();
    categoryCreateMany.mockReset();
    categoryFindMany.mockReset();
    categoryRuleCreateMany.mockReset();
    categoryRuleCreateMany.mockResolvedValue({ count: 0 });
  });

  it("still seeds missing defaults when the user already has some rules", async () => {
    const workspaceId = "ws-user-partial";
    const userId = "user-partial";
    categoryCount.mockResolvedValue(16);
    categoryFindMany.mockResolvedValue([
      { id: "cat-subs", name: "Subscriptions" },
      { id: "cat-groceries", name: "Groceries" },
      { id: "cat-transport", name: "Transport" },
      { id: "cat-dining", name: "Dining" },
      { id: "cat-housing", name: "Housing" },
      { id: "cat-salary", name: "Salary" },
      { id: "cat-freelance", name: "Freelance" },
      { id: "cat-shopping", name: "Shopping" },
    ]);

    await ensureDefaultCategories(workspaceId, userId);

    expect(categoryCreateMany).not.toHaveBeenCalled();
    expect(categoryRuleCreateMany).toHaveBeenCalledOnce();
    const { data, skipDuplicates } = categoryRuleCreateMany.mock.calls[0][0] as {
      data: { workspaceId: string; userId: string; pattern: string; categoryId: string }[];
      skipDuplicates: boolean;
    };
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(DEFAULT_CATEGORY_RULES.length);
    expect(data.find((row) => row.pattern === "uber")).toEqual({
      workspaceId,
      userId,
      pattern: "uber",
      categoryId: "cat-transport",
    });
    expect(data.find((row) => row.pattern === "amazon")).toEqual({
      workspaceId,
      userId,
      pattern: "amazon",
      categoryId: "cat-shopping",
    });
  });

  it("seeds categories then rules for a brand-new empty account", async () => {
    const workspaceId = "ws-user-new";
    const userId = "user-new";
    categoryCount.mockResolvedValue(0);
    categoryCreateMany.mockResolvedValue({ count: 16 });
    categoryFindMany.mockResolvedValue([{ id: "cat-transport", name: "Transport" }]);

    await ensureDefaultCategories(workspaceId, userId);

    expect(categoryCreateMany).toHaveBeenCalledOnce();
    expect(categoryRuleCreateMany).toHaveBeenCalledOnce();
    const { data } = categoryRuleCreateMany.mock.calls[0][0] as {
      data: { pattern: string }[];
    };
    expect(data.some((row) => row.pattern === "uber")).toBe(true);
  });
});
