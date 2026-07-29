import { describe, expect, it } from "vitest";

import {
  detectCurrencyInText,
  parseCurrencyCode,
  resolveInvoiceCurrency,
} from "@/lib/currency/parse";

describe("parseCurrencyCode", () => {
  it("reads ISO codes and symbols", () => {
    expect(parseCurrencyCode("EUR")).toBe("EUR");
    expect(parseCurrencyCode("€ 12,50")).toBe("EUR");
    expect(parseCurrencyCode("£99.00")).toBe("GBP");
    expect(parseCurrencyCode("Amount in CHF")).toBe("CHF");
    expect(parseCurrencyCode("euros")).toBe("EUR");
  });
});

describe("detectCurrencyInText", () => {
  it("finds currency on invoice-like text", () => {
    expect(detectCurrencyInText("Invoice total: €1.210,00\nVAT 21%")).toBe("EUR");
    expect(detectCurrencyInText("Currency: GBP\nTotal 100.00")).toBe("GBP");
  });
});

describe("resolveInvoiceCurrency", () => {
  it("prefers extracted, then document text, then profile", () => {
    expect(
      resolveInvoiceCurrency({
        extracted: "eur",
        documentText: "Total $50",
        fallback: "USD",
      })
    ).toBe("EUR");

    expect(
      resolveInvoiceCurrency({
        extracted: null,
        documentText: "Factuur €40,00",
        fallback: "USD",
      })
    ).toBe("EUR");

    expect(
      resolveInvoiceCurrency({
        extracted: null,
        documentText: null,
        fallback: "CAD",
      })
    ).toBe("CAD");
  });
});
