import { z } from "zod";

import { BUSINESS_TYPES, EMPLOYEE_RANGES } from "@/lib/onboarding/benchmarks";

/** Form / API body shape (no transforms — keeps RHF input/output aligned). */
export const onboardingSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES),
  employeeRange: z.enum(EMPLOYEE_RANGES),
  monthlyRent: z.number().nonnegative("Enter a non-negative amount").max(1_000_000_000).nullable(),
  monthlyRevenue: z
    .number()
    .nonnegative("Enter a non-negative amount")
    .max(1_000_000_000)
    .nullable(),
  location: z.string().max(120).nullable(),
  businessNotes: z.string().max(500).nullable(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

/** Normalize empty strings and coerce API payloads before schema parse. */
export function normalizeOnboardingInput(body: unknown): unknown {
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

  return {
    ...raw,
    monthlyRent: money(raw.monthlyRent),
    monthlyRevenue: money(raw.monthlyRevenue),
    location: text(raw.location),
    businessNotes: text(raw.businessNotes),
  };
}
