import { describe, expect, it } from "vitest";

import { isProductTourDone, productTourSteps } from "@/lib/tour/steps";

describe("isProductTourDone", () => {
  it("is false when the flag is missing", () => {
    expect(isProductTourDone(null)).toBe(false);
    expect(isProductTourDone(undefined)).toBe(false);
    expect(isProductTourDone({ tourCompletedAt: null })).toBe(false);
  });

  it("is true once completed or skipped (same timestamp field)", () => {
    expect(isProductTourDone({ tourCompletedAt: new Date() })).toBe(true);
    expect(isProductTourDone({ tourCompletedAt: "2026-08-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("productTourSteps", () => {
  it("returns the same step ids for both editions", () => {
    const business = productTourSteps("business").map((s) => s.id);
    const personal = productTourSteps("personal").map((s) => s.id);
    expect(business).toEqual(["welcome", "connect", "transactions", "dashboard", "copilot", "cta"]);
    expect(personal).toEqual(business);
  });

  it("uses edition-aware dashboard copy", () => {
    const businessDash = productTourSteps("business").find((s) => s.id === "dashboard");
    const personalDash = productTourSteps("personal").find((s) => s.id === "dashboard");
    expect(businessDash?.title).toMatch(/cash/i);
    expect(personalDash?.title).toMatch(/budget/i);
    expect(personalDash?.body).toMatch(/Budgets/i);
    expect(businessDash?.body).toMatch(/Invoices/i);
  });

  it("ends with an Import CTA", () => {
    const cta = productTourSteps("personal").find((s) => s.id === "cta");
    expect(cta?.href).toBe("/import");
    expect(cta?.hrefLabel).toBeTruthy();
  });
});
