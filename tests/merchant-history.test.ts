import { describe, expect, it } from "vitest";

import {
  buildMerchantCategoryIndex,
  matchMerchantHistory,
  merchantKeyFromTransaction,
  normalizeMerchantKey,
} from "@/lib/ai/categorize-core";

describe("normalizeMerchantKey / merchantKeyFromTransaction", () => {
  it("strips digits and punctuation", () => {
    expect(normalizeMerchantKey("Albert Heijn #1234")).toBe("albert heijn");
    expect(normalizeMerchantKey("UBER *TRIP 8842")).toBe("uber trip");
  });

  it("prefers counterparty over description", () => {
    expect(merchantKeyFromTransaction("POS PURCHASE", "Spotify AB")).toBe("spotify ab");
    expect(merchantKeyFromTransaction("Shell Station A12", null)).toBe("shell station a");
  });

  it("returns null for empty input", () => {
    expect(merchantKeyFromTransaction("", null)).toBeNull();
    expect(merchantKeyFromTransaction("1", "")).toBeNull();
  });
});

describe("buildMerchantCategoryIndex / matchMerchantHistory", () => {
  it("keeps the newest (first) category per payee and direction", () => {
    const index = buildMerchantCategoryIndex([
      { merchant: "Albert Heijn", categoryId: "groceries", type: "EXPENSE" },
      { merchant: "albert heijn #99", categoryId: "shopping", type: "EXPENSE" },
      { merchant: "Acme BV", categoryId: "salary", type: "INCOME" },
    ]);

    expect(matchMerchantHistory("AH", "Albert Heijn", "EXPENSE", index)).toBe("groceries");
    expect(matchMerchantHistory("SALARY", "Acme BV", "INCOME", index)).toBe("salary");
    expect(matchMerchantHistory("AH", "Albert Heijn", "INCOME", index)).toBeNull();
  });

  it("does not cross-match unrelated merchants", () => {
    const index = buildMerchantCategoryIndex([
      { merchant: "Netflix", categoryId: "subs", type: "EXPENSE" },
    ]);
    expect(matchMerchantHistory("Spotify", null, "EXPENSE", index)).toBeNull();
  });
});
