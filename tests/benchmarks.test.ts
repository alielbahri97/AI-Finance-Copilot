import { describe, expect, it } from "vitest";

import {
  formatRatioGuidance,
  getRecommendations,
  isOnboardingDone,
} from "@/lib/onboarding/benchmarks";

describe("getRecommendations", () => {
  it("returns restaurant labor, COGS, and rent guidelines", () => {
    const result = getRecommendations({ businessType: "RESTAURANT" });
    expect(result.businessTypeLabel).toMatch(/Restaurant/i);
    expect(result.disclaimer.length).toBeGreaterThan(40);

    const ids = result.ratios.map((r) => r.id);
    expect(ids).toContain("labor");
    expect(ids).toContain("cogs");
    expect(ids).toContain("rent");
    expect(ids).toContain("prime_cost");

    const labor = result.ratios.find((r) => r.id === "labor")!;
    expect(labor.lowPct).toBe(25);
    expect(labor.highPct).toBe(35);
    expect(labor.kind).toBe("ceiling");
  });

  it("returns SaaS gross-margin floor around 70–85%", () => {
    const result = getRecommendations({ businessType: "SAAS" });
    const gm = result.ratios.find((r) => r.id === "gross_margin")!;
    expect(gm.lowPct).toBe(70);
    expect(gm.highPct).toBe(85);
    expect(gm.kind).toBe("floor");
  });

  it("flags rent above the restaurant guideline when revenue is provided", () => {
    const result = getRecommendations({
      businessType: "RESTAURANT",
      monthlyRent: 12_000,
      monthlyRevenue: 50_000, // 24% rent — well above 5–10%
    });
    expect(result.insights.some((i) => i.id === "rent_vs_revenue")).toBe(true);
    const rent = result.insights.find((i) => i.id === "rent_vs_revenue")!;
    expect(rent.outsideGuideline).toBe(true);
    expect(rent.message).toMatch(/24%/);
  });

  it("notes rent within guideline without marking as outside", () => {
    const result = getRecommendations({
      businessType: "RESTAURANT",
      monthlyRent: 4_000,
      monthlyRevenue: 50_000, // 8%
    });
    const rent = result.insights.find((i) => i.id === "rent_vs_revenue")!;
    expect(rent.outsideGuideline).toBe(false);
    expect(rent.message).toMatch(/within/i);
  });

  it("adds a staffing insight when employees and revenue are set", () => {
    const result = getRecommendations({
      businessType: "SAAS",
      employeeRange: "SMALL",
      monthlyRevenue: 20_000,
    });
    expect(result.insights.some((i) => i.id === "revenue_per_employee")).toBe(true);
  });

  it("covers every business type with at least three ratios", () => {
    const types = [
      "RESTAURANT",
      "RETAIL",
      "SERVICES",
      "SAAS",
      "CONSTRUCTION",
      "PROFESSIONAL",
      "HEALTHCARE",
      "MANUFACTURING",
      "OTHER",
    ] as const;
    for (const businessType of types) {
      const result = getRecommendations({ businessType });
      expect(result.ratios.length).toBeGreaterThanOrEqual(3);
      for (const ratio of result.ratios) {
        expect(ratio.highPct).toBeGreaterThanOrEqual(ratio.lowPct);
        expect(formatRatioGuidance(ratio)).toMatch(/Typical range/i);
      }
    }
  });
});

describe("isOnboardingDone", () => {
  it("is false when profile is missing", () => {
    expect(isOnboardingDone(null)).toBe(false);
    expect(isOnboardingDone(undefined)).toBe(false);
  });

  it("is true when completed or skipped", () => {
    expect(isOnboardingDone({ completedAt: new Date(), skippedAt: null })).toBe(true);
    expect(isOnboardingDone({ completedAt: null, skippedAt: "2026-01-01" })).toBe(true);
    expect(isOnboardingDone({ completedAt: null, skippedAt: null })).toBe(false);
  });
});
