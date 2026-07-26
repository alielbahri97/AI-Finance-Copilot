import { z } from "zod";

const label = z.string().trim().min(1, "Enter a label").max(100);
const flowType = z.enum(["INCOME", "EXPENSE"]);
const amount = z.coerce.number().positive("Amount must be positive").max(1_000_000_000);
const optionalDate = z.coerce.date().nullable().optional();

export const assumptionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ONE_OFF"),
    label,
    type: flowType,
    amount,
    date: z.coerce.date({ error: "Pick a date" }),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("RECURRING"),
    label,
    type: flowType,
    amount,
    startDate: optionalDate,
    endDate: optionalDate,
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("PERCENT_GROWTH"),
    label,
    type: flowType,
    percent: z.coerce
      .number({ error: "Enter a percentage" })
      .min(-50, "Minimum is -50% per month")
      .max(100, "Maximum is 100% per month"),
    startDate: optionalDate,
    endDate: optionalDate,
    enabled: z.boolean().optional(),
  }),
]);

export type AssumptionValues = z.infer<typeof assumptionSchema>;

export const assumptionToggleSchema = z.object({ enabled: z.boolean() });

/** Returns an error message when the date window is inverted, else null. */
export function validateDateWindow(values: AssumptionValues): string | null {
  if (values.kind === "ONE_OFF") return null;
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    return "End date must be on or after the start date";
  }
  return null;
}

/** Maps validated values to the Prisma column shape (nulling unused fields). */
export function toAssumptionData(values: AssumptionValues) {
  return {
    kind: values.kind,
    type: values.type,
    label: values.label,
    amount: values.kind === "PERCENT_GROWTH" ? null : values.amount,
    percent: values.kind === "PERCENT_GROWTH" ? values.percent : null,
    date: values.kind === "ONE_OFF" ? values.date : null,
    startDate: values.kind === "ONE_OFF" ? null : (values.startDate ?? null),
    endDate: values.kind === "ONE_OFF" ? null : (values.endDate ?? null),
    enabled: values.enabled ?? true,
  };
}
