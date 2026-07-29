import { describe, expect, it } from "vitest";

import {
  currencyFromAcceptLanguage,
  currencyFromCountryCode,
  currencyFromLocationText,
  currencyFromRequestHeaders,
} from "@/lib/currency/location";

describe("currencyFromCountryCode", () => {
  it("maps common countries", () => {
    expect(currencyFromCountryCode("NL")).toBe("EUR");
    expect(currencyFromCountryCode("gb")).toBe("GBP");
    expect(currencyFromCountryCode("US")).toBe("USD");
    expect(currencyFromCountryCode("JP")).toBe("JPY");
    expect(currencyFromCountryCode("NZ")).toBe("NZD");
  });

  it("defaults unknown countries to USD", () => {
    expect(currencyFromCountryCode("ZZ")).toBe("USD");
    expect(currencyFromCountryCode(null)).toBe("USD");
  });
});

describe("currencyFromLocationText", () => {
  it("infers from city or country names", () => {
    expect(currencyFromLocationText("Amsterdam")).toBe("EUR");
    expect(currencyFromLocationText("Netherlands")).toBe("EUR");
    expect(currencyFromLocationText("London, UK")).toBe("GBP");
    expect(currencyFromLocationText("Toronto")).toBe("CAD");
    expect(currencyFromLocationText("Sydney, Australia")).toBe("AUD");
  });

  it("accepts ISO country codes", () => {
    expect(currencyFromLocationText("DE")).toBe("EUR");
    expect(currencyFromLocationText("ch")).toBe("CHF");
  });

  it("returns null when unknown", () => {
    expect(currencyFromLocationText("")).toBeNull();
    expect(currencyFromLocationText("Somewhere")).toBeNull();
  });
});

describe("currencyFromAcceptLanguage", () => {
  it("uses region tags", () => {
    expect(currencyFromAcceptLanguage("en-GB,en;q=0.9")).toBe("GBP");
    expect(currencyFromAcceptLanguage("nl-NL,nl;q=0.9,en;q=0.8")).toBe("EUR");
  });
});

describe("currencyFromRequestHeaders", () => {
  it("prefers Vercel geo country", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "NL",
      "accept-language": "en-US",
    });
    expect(currencyFromRequestHeaders(headers)).toBe("EUR");
  });

  it("falls back to Accept-Language", () => {
    const headers = new Headers({ "accept-language": "en-GB" });
    expect(currencyFromRequestHeaders(headers)).toBe("GBP");
  });
});
