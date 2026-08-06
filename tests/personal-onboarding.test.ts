import { describe, expect, it } from "vitest";

import {
  getPersonalRecommendations,
  isPersonalOnboardingDone,
} from "@/lib/onboarding/personal";

describe("personal onboarding recommendations", () => {
  it("suggests an emergency fund when the buffer is thin", () => {
    const result = getPersonalRecommendations({
      lifeStage: "EARLY_CAREER",
      primaryFocus: "GENERAL_WEALTH",
      monthlyEssentials: 2000,
      emergencyMonths: 0,
    });
    expect(result.suggestedGoals.some((goal) => goal.id === "emergency")).toBe(true);
    expect(result.suggestedGoals.find((goal) => goal.id === "emergency")?.targetAmount).toBe(
      6000
    );
  });

  it("suggests debt payoff when hasDebt is set", () => {
    const result = getPersonalRecommendations({
      lifeStage: "MID_CAREER",
      primaryFocus: "HOME",
      hasDebt: true,
      monthlyIncome: 4000,
      emergencyMonths: 4,
    });
    expect(result.suggestedGoals.some((goal) => goal.id === "debt")).toBe(true);
    expect(result.suggestedGoals.some((goal) => goal.id === "home")).toBe(true);
  });

  it("treats completed or skipped as done", () => {
    expect(isPersonalOnboardingDone(null)).toBe(false);
    expect(
      isPersonalOnboardingDone({ completedAt: new Date(), skippedAt: null })
    ).toBe(true);
    expect(
      isPersonalOnboardingDone({ completedAt: null, skippedAt: new Date() })
    ).toBe(true);
  });
});
