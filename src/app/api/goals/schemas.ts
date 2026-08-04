import { z } from "zod";

/**
 * Request validation for the goals routes. Lives beside the routes rather than
 * in `@/lib/validations` because nothing outside `/api/goals` submits a goal.
 */

const name = z.string().trim().min(1, "Enter a name").max(80);
const positiveAmount = z.coerce
  .number({ error: "Enter an amount" })
  .positive("Amount must be positive")
  .max(1_000_000_000);
const startingAmount = z.coerce
  .number({ error: "Enter an amount" })
  .min(0, "Amount cannot be negative")
  .max(1_000_000_000);
/** Ids are only ever used after being checked against the workspace. */
const linkId = z.string().trim().min(1).max(64).nullish();
const note = z.string().trim().max(500).nullish();

export const goalCreateSchema = z.object({
  name,
  targetAmount: positiveAmount,
  targetDate: z.coerce.date({ error: "Pick a target date" }).nullish(),
  startingAmount: startingAmount.optional(),
  categoryId: linkId,
  bankAccountId: linkId,
  note,
});

/**
 * Every field optional: absent means "leave as it is", explicit `null` means
 * "clear it". That distinction is what lets a link or a target date be removed
 * without the client having to resend the whole goal.
 */
export const goalUpdateSchema = z.object({
  name: name.optional(),
  targetAmount: positiveAmount.optional(),
  targetDate: z.coerce.date({ error: "Pick a target date" }).nullish(),
  startingAmount: startingAmount.optional(),
  categoryId: linkId,
  bankAccountId: linkId,
  note,
  archived: z.boolean().optional(),
});

export const contributionCreateSchema = z.object({
  amount: positiveAmount,
  date: z.coerce.date({ error: "Pick a date" }),
  note,
  transactionId: linkId,
});

/** Midnight UTC: target dates are a day, not a moment, so they compare by day. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Last instant of today, UTC. */
export function endOfUtcDay(now = new Date()): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000 - 1);
}
