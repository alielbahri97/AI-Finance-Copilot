import { describe, expect, it } from "vitest";

import {
  accountLast4,
  accountNameMatches,
  extractIbans,
  isInternalTransfer,
  isTransferCategoryName,
  matchesOwnAccount,
  normalizeIban,
  transferCategoryNameFor,
  type OwnAccountRef,
} from "@/lib/transfers";

const ACCOUNTS: OwnAccountRef[] = [
  { name: "Main checking", mask: "…4521" },
  { name: "ING Spaarrekening Ali", mask: "…8890" },
];

describe("normalizeIban / extractIbans", () => {
  it("strips spaces and uppercases", () => {
    expect(normalizeIban("nl91 abna 0417 1643 00")).toBe("NL91ABNA0417164300");
  });

  it("finds IBANs in remittance text", () => {
    expect(extractIbans("Overboeking naar NL91 ABNA 0417 1643 00 spaar")).toEqual([
      "NL91ABNA0417164300",
    ]);
  });

  it("ignores short or empty input", () => {
    expect(extractIbans("")).toEqual([]);
    expect(extractIbans("ref 1234")).toEqual([]);
  });
});

describe("accountLast4 / accountNameMatches", () => {
  it("reads last four from a mask or IBAN", () => {
    expect(accountLast4("…4521")).toBe("4521");
    expect(accountLast4("NL91ABNA0417164300")).toBe("4300");
    expect(accountLast4("12")).toBeNull();
  });

  it("matches distinctive account names and skips generic ones", () => {
    expect(accountNameMatches("to ING Spaarrekening Ali", "ING Spaarrekening Ali")).toBe(true);
    expect(accountNameMatches("Savings deposit", "Savings")).toBe(false);
    expect(accountNameMatches("payment", "ab")).toBe(false);
  });
});

describe("matchesOwnAccount", () => {
  it("matches on IBAN last-4 against a linked mask", () => {
    expect(
      matchesOwnAccount("SEPA NL12INGB0001238890", null, ACCOUNTS)
    ).toBe(true);
  });

  it("matches on a literal ellipsis mask echo", () => {
    expect(matchesOwnAccount("To account …4521", null, ACCOUNTS)).toBe(true);
  });

  it("matches on distinctive account name", () => {
    expect(
      matchesOwnAccount("Internal", "ING Spaarrekening Ali", ACCOUNTS)
    ).toBe(true);
  });

  it("returns false with no linked accounts or no signal", () => {
    expect(matchesOwnAccount("Coffee shop", "Starbucks", [])).toBe(false);
    expect(matchesOwnAccount("Coffee shop", "Starbucks", ACCOUNTS)).toBe(false);
  });
});

describe("isInternalTransfer", () => {
  it("fires on strong wording alone", () => {
    expect(isInternalTransfer("Eigen rekening overboeking", null, [])).toBe(true);
    expect(isInternalTransfer("Transfer to my savings", null, [])).toBe(true);
    expect(isInternalTransfer("Interne overboeking spaar", null, [])).toBe(true);
  });

  it("with ≥2 linked accounts, an own-account hit is enough", () => {
    expect(
      isInternalTransfer("NL12INGB0001238890", null, ACCOUNTS)
    ).toBe(true);
  });

  it("with a single linked account, requires transfer wording too", () => {
    const one: OwnAccountRef[] = [{ name: "Main checking", mask: "…4521" }];
    expect(isInternalTransfer("Payment to …4521", "Vendor BV", one)).toBe(false);
    expect(isInternalTransfer("Overboeking to …4521", null, one)).toBe(true);
  });

  it("does not treat a generic bank transfer as internal", () => {
    expect(isInternalTransfer("Bank transfer to Acme", "Acme BV", ACCOUNTS)).toBe(false);
  });
});

describe("transfer category helpers", () => {
  it("recognises seeded and alias names", () => {
    expect(isTransferCategoryName("Transfer")).toBe(true);
    expect(isTransferCategoryName("transfer in")).toBe(true);
    expect(isTransferCategoryName("Savings / Transfer")).toBe(true);
    expect(isTransferCategoryName("Groceries")).toBe(false);
  });

  it("picks the direction-appropriate name", () => {
    expect(transferCategoryNameFor("EXPENSE")).toBe("Transfer");
    expect(transferCategoryNameFor("INCOME")).toBe("Transfer in");
  });
});
