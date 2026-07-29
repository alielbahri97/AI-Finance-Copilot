import { describe, expect, it } from "vitest";

import {
  compactCategoryPattern,
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
