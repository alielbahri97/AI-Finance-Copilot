/**
 * Personal first-run questionnaire → suggested goals and planning tips.
 * Guidelines only — not financial advice.
 */

export const LIFE_STAGES = [
  "STUDENT",
  "EARLY_CAREER",
  "MID_CAREER",
  "FAMILY",
  "PRE_RETIREMENT",
  "RETIRED",
  "OTHER",
] as const;

export type LifeStageId = (typeof LIFE_STAGES)[number];

export const LIFE_STAGE_LABELS: Record<LifeStageId, string> = {
  STUDENT: "Student",
  EARLY_CAREER: "Early career",
  MID_CAREER: "Mid career",
  FAMILY: "Raising a family",
  PRE_RETIREMENT: "Approaching retirement",
  RETIRED: "Retired",
  OTHER: "Something else",
};

export const PRIMARY_FOCUSES = [
  "EMERGENCY_FUND",
  "DEBT",
  "HOME",
  "RETIREMENT",
  "TRAVEL",
  "EDUCATION",
  "GENERAL_WEALTH",
] as const;

export type PrimaryFocusId = (typeof PRIMARY_FOCUSES)[number];

export const PRIMARY_FOCUS_LABELS: Record<PrimaryFocusId, string> = {
  EMERGENCY_FUND: "Build an emergency fund",
  DEBT: "Pay down debt",
  HOME: "Save for a home",
  RETIREMENT: "Invest for retirement",
  TRAVEL: "Save for a trip or experience",
  EDUCATION: "Education / upskilling",
  GENERAL_WEALTH: "Grow wealth overall",
};

export interface PersonalContextInput {
  lifeStage: LifeStageId;
  primaryFocus: PrimaryFocusId;
  monthlyIncome?: number | null;
  monthlyEssentials?: number | null;
  hasDebt?: boolean;
  emergencyMonths?: number;
  notes?: string | null;
}

export interface SuggestedGoal {
  id: string;
  name: string;
  /** Suggested target in the workspace currency; null = user picks. */
  targetAmount: number | null;
  /** Rough months from now for a target date; null = no deadline. */
  horizonMonths: number | null;
  reason: string;
}

export interface PersonalInsight {
  id: string;
  label: string;
  message: string;
  href?: string;
}

export interface PersonalRecommendationResult {
  lifeStageLabel: string;
  primaryFocusLabel: string;
  disclaimer: string;
  suggestedGoals: SuggestedGoal[];
  insights: PersonalInsight[];
}

export function isPersonalOnboardingDone(
  row: { completedAt: Date | null; skippedAt: Date | null } | null | undefined
): boolean {
  return Boolean(row?.completedAt || row?.skippedAt);
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 100) return Math.round(value);
  if (value < 1000) return Math.round(value / 10) * 10;
  return Math.round(value / 50) * 50;
}

/**
 * Build suggested savings goals and tips from questionnaire answers.
 * Pure — safe for unit tests and for the results step before anything is saved.
 */
export function getPersonalRecommendations(
  input: PersonalContextInput
): PersonalRecommendationResult {
  const essentials = input.monthlyEssentials ?? null;
  const income = input.monthlyIncome ?? null;
  const emergencyMonths = Math.max(0, Math.min(24, input.emergencyMonths ?? 0));
  const hasDebt = Boolean(input.hasDebt);

  const suggestedGoals: SuggestedGoal[] = [];
  const insights: PersonalInsight[] = [];

  const emergencyTarget =
    essentials != null && essentials > 0 ? roundMoney(essentials * 3) : null;

  if (input.primaryFocus === "EMERGENCY_FUND" || emergencyMonths < 3) {
    suggestedGoals.push({
      id: "emergency",
      name: "Emergency fund",
      targetAmount: emergencyTarget,
      horizonMonths: emergencyMonths < 1 ? 6 : 12,
      reason:
        emergencyMonths < 3
          ? "A cash buffer of about three months of essentials is a common first target before bigger goals."
          : "Keep topping up the buffer so a surprise bill does not wipe out other plans.",
    });
  }

  if (input.primaryFocus === "DEBT" || hasDebt) {
    suggestedGoals.push({
      id: "debt",
      name: "Debt payoff fund",
      targetAmount: income != null ? roundMoney(income * 2) : null,
      horizonMonths: 18,
      reason:
        "Park extra payments toward the highest-interest balance first, then roll that payment to the next.",
    });
    insights.push({
      id: "debt-tip",
      label: "Debt focus",
      message:
        "List each balance and interest rate. Pay minimums everywhere, then push surplus at the costliest debt.",
      href: "/budgets",
    });
  }

  if (input.primaryFocus === "HOME") {
    suggestedGoals.push({
      id: "home",
      name: "Home deposit",
      targetAmount: income != null ? roundMoney(income * 12) : null,
      horizonMonths: 36,
      reason: "A dedicated deposit pot keeps house savings separate from day-to-day spending.",
    });
  }

  if (input.primaryFocus === "RETIREMENT" || input.lifeStage === "PRE_RETIREMENT") {
    suggestedGoals.push({
      id: "retirement",
      name: "Retirement / long-term investing",
      targetAmount: income != null ? roundMoney(income * 6) : null,
      horizonMonths: null,
      reason: "A long horizon goal with no hard deadline — contribute steadily and review yearly.",
    });
  }

  if (input.primaryFocus === "TRAVEL") {
    suggestedGoals.push({
      id: "travel",
      name: "Travel fund",
      targetAmount: income != null ? roundMoney(income * 1.5) : 2000,
      horizonMonths: 12,
      reason: "Pick a trip budget and date so monthly contributions stay concrete.",
    });
  }

  if (input.primaryFocus === "EDUCATION" || input.lifeStage === "STUDENT") {
    suggestedGoals.push({
      id: "education",
      name: "Education / skills",
      targetAmount: income != null ? roundMoney(income * 2) : 1500,
      horizonMonths: 12,
      reason: "Courses and certifications are easier to fund when they have their own envelope.",
    });
  }

  if (input.primaryFocus === "GENERAL_WEALTH" && suggestedGoals.length === 0) {
    suggestedGoals.push({
      id: "wealth",
      name: "Wealth building",
      targetAmount: income != null ? roundMoney(income * 3) : null,
      horizonMonths: 24,
      reason: "A general investing pot works once an emergency buffer is in place.",
    });
  }

  if (input.lifeStage === "FAMILY") {
    insights.push({
      id: "family",
      label: "Family stage",
      message:
        "Track childcare and household costs as budgets so goals stay funded when monthly spend swings.",
      href: "/budgets",
    });
  }

  if (income != null && essentials != null && essentials > income * 0.7) {
    insights.push({
      id: "tight-budget",
      label: "Tight monthly margin",
      message:
        "Essentials look high relative to income. Start with one small goal and a category budget before stretching targets.",
      href: "/budgets",
    });
  }

  if (emergencyMonths >= 3 && input.primaryFocus !== "EMERGENCY_FUND") {
    insights.push({
      id: "buffer-ok",
      label: "Emergency buffer",
      message: "You already report a solid buffer — focus contributions on your primary goal next.",
      href: "/goals",
    });
  }

  insights.push({
    id: "next-steps",
    label: "What to do next",
    message:
      "Connect a bank or import a statement, then turn the suggestions below into Goals. Ballast will track progress on the dashboard.",
    href: "/import",
  });

  // De-dupe by id while preserving order
  const seen = new Set<string>();
  const uniqueGoals = suggestedGoals.filter((goal) => {
    if (seen.has(goal.id)) return false;
    seen.add(goal.id);
    return true;
  });

  return {
    lifeStageLabel: LIFE_STAGE_LABELS[input.lifeStage],
    primaryFocusLabel: PRIMARY_FOCUS_LABELS[input.primaryFocus],
    disclaimer:
      "These are planning suggestions based on your answers — not personalised financial advice. Adjust targets to fit your situation.",
    suggestedGoals: uniqueGoals,
    insights,
  };
}
