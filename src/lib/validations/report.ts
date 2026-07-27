import { z } from "zod";

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional();

/** Query params accepted by the reports export routes. */
export const reportQuerySchema = z.object({
  period: z
    .enum(["this-month", "last-month", "quarter", "ytd", "last-12m", "custom"])
    .optional(),
  from: isoDay,
  to: isoDay,
  dataset: z.enum(["transactions", "monthly"]).optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
