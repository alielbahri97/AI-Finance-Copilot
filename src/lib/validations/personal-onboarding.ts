import { z } from "zod";

import { LIFE_STAGES, PRIMARY_FOCUSES } from "@/lib/onboarding/personal";

export const personalOnboardingSchema = z.object({
  lifeStage: z.enum(LIFE_STAGES),
  primaryFocus: z.enum(PRIMARY_FOCUSES),
  monthlyIncome: z
    .number()
    .nonnegative("Enter a non-negative amount")
    .max(1_000_000_000)
    .nullable(),
  monthlyEssentials: z
    .number()
    .nonnegative("Enter a non-negative amount")
    .max(1_000_000_000)
    .nullable(),
  hasDebt: z.boolean(),
  emergencyMonths: z.number().int().min(0).max(24),
  notes: z.string().max(500).nullable(),
});

export type PersonalOnboardingValues = z.infer<typeof personalOnboardingSchema>;

export function normalizePersonalOnboardingInput(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const raw = body as Record<string, unknown>;

  const money = (value: unknown): number | null | unknown => {
    if (value === null || value === undefined || value === "") return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : value;
  };

  const text = (value: unknown): string | null | unknown => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const months = (value: unknown): number | unknown => {
    if (value === null || value === undefined || value === "") return 0;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : value;
  };

  return {
    ...raw,
    monthlyIncome: money(raw.monthlyIncome),
    monthlyEssentials: money(raw.monthlyEssentials),
    hasDebt: Boolean(raw.hasDebt),
    emergencyMonths: months(raw.emergencyMonths),
    notes: text(raw.notes),
  };
}
