import { describe, expect, it } from "vitest";

import { dateFnsLocale } from "@/lib/date-fns-locale";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  localeForCurrency,
} from "@/lib/utils";

/**
 * Assertions avoid exact separator characters: ICU uses a narrow no-break
 * space in several of these locales and swaps it between versions. What
 * matters is that the locale argument reaches the formatter and changes the
 * shape, and that omitting it leaves en-US behaviour untouched.
 */
const DIGITS_AND_SEPARATORS = /[\d.,\u00a0\u202f\s]/g;

describe("formatCurrency", () => {
  it("defaults to en-US so untouched call sites keep their output", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
    expect(formatCurrency(1234.56, "USD")).toBe("$1,234.56");
    expect(formatCurrency(1234.56, "USD", "en-US")).toBe("$1,234.56");
  });

  it("groups and places the symbol per the locale", () => {
    const german = formatCurrency(1234.56, "EUR", "de-DE");
    expect(german).toContain("1.234,56");
    expect(german.trimEnd().endsWith("€")).toBe(true);

    const british = formatCurrency(1234.56, "GBP", "en-GB");
    expect(british).toBe("£1,234.56");
  });

  it("keeps the currency independent of the locale", () => {
    // A Dutch reader holding a USD account: Dutch grouping, dollar amount.
    const dutch = formatCurrency(1234.56, "USD", "nl-NL");
    expect(dutch).toContain("$");
    expect(dutch).toContain("1.234,56");
  });

  it("renders negatives and zero without losing the locale", () => {
    expect(formatCurrency(-99.5, "USD", "en-US")).toBe("-$99.50");
    expect(formatCurrency(0, "EUR", "de-DE").replace(DIGITS_AND_SEPARATORS, "")).toBe("€");
  });
});

describe("localeForCurrency", () => {
  it("maps each supported currency to a locale", () => {
    expect(localeForCurrency("USD")).toBe("en-US");
    expect(localeForCurrency("EUR")).toBe("de-DE");
    expect(localeForCurrency("GBP")).toBe("en-GB");
    expect(localeForCurrency("AUD")).toBe("en-AU");
    expect(localeForCurrency("CAD")).toBe("en-CA");
    expect(localeForCurrency("CHF")).toBe("de-CH");
    expect(localeForCurrency("JPY")).toBe("ja-JP");
    expect(localeForCurrency("NZD")).toBe("en-NZ");
  });

  it("is case-insensitive and falls back to en-US", () => {
    expect(localeForCurrency("eur")).toBe("de-DE");
    expect(localeForCurrency("SEK")).toBe("en-US");
    expect(localeForCurrency(null)).toBe("en-US");
    expect(localeForCurrency(undefined)).toBe("en-US");
  });
});

describe("formatDate", () => {
  const iso = "2026-03-09T00:00:00.000Z";

  it("defaults to en-US so untouched call sites keep their output", () => {
    expect(formatDate(iso)).toBe("Mar 9, 2026");
    expect(formatDate(new Date(iso))).toBe("Mar 9, 2026");
    expect(formatDate(iso, "en-US")).toBe("Mar 9, 2026");
  });

  it("reorders the parts per the locale", () => {
    expect(formatDate(iso, "en-GB")).toBe("9 Mar 2026");
    expect(formatDate(iso, "de-DE")).toContain("2026");
    expect(formatDate(iso, "de-DE").startsWith("9.")).toBe(true);
    expect(formatDate(iso, "ja-JP")).toBe("2026年3月9日");
  });
});

describe("formatDateTime", () => {
  const iso = "2026-03-09T14:05:00.000Z";

  it("defaults to en-US and includes the time", () => {
    const stamp = formatDateTime(iso);
    expect(stamp).toContain("Mar 9");
    expect(stamp).toMatch(/\d{1,2}:\d{2}/);
  });

  it("takes a locale", () => {
    expect(formatDateTime(iso, "de-DE")).toContain("9. März");
  });
});

describe("dateFnsLocale", () => {
  it("defaults to en-US", () => {
    expect(dateFnsLocale().code).toBe("en-US");
    expect(dateFnsLocale("en-US").code).toBe("en-US");
  });

  it("resolves the tags localeForCurrency produces", () => {
    expect(dateFnsLocale("en-GB").code).toBe("en-GB");
    expect(dateFnsLocale("en-AU").code).toBe("en-AU");
    expect(dateFnsLocale("en-CA").code).toBe("en-CA");
    expect(dateFnsLocale("en-NZ").code).toBe("en-NZ");
    expect(dateFnsLocale("de-DE").code).toBe("de");
    expect(dateFnsLocale("ja-JP").code).toBe("ja");
  });

  it("falls back through the base language before en-US", () => {
    // date-fns ships no de-CH bundle; German is a better answer than English.
    expect(dateFnsLocale("de-CH").code).toBe("de");
    expect(dateFnsLocale("xx-YY").code).toBe("en-US");
  });
});
