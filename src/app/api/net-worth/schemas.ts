import { z } from "zod";

import { ASSET_KINDS } from "@/lib/personal/net-worth";

/**
 * Request validation for the net-worth routes. Lives beside the routes rather
 * than in `@/lib/validations` because nothing outside `/api/net-worth` submits
 * a holding.
 */

const name = z.string().trim().min(1, "Enter a name").max(80);

/**
 * A valuation is never negative: a liability is entered as what is owed, and
 * the arithmetic subtracts it. Zero is allowed — a paid-off loan is worth
 * recording as 0 rather than deleting, which keeps the history intact.
 */
const value = z.coerce
  .number({ error: "Enter an amount" })
  .min(0, "Enter what it is worth as a positive amount")
  .max(1_000_000_000_000);

const kind = z.enum(ASSET_KINDS);

/** ISO 4217 is three letters; anything else is a typo, not a currency. */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code")
  .nullish();

const note = z.string().trim().max(500).nullish();

export const assetCreateSchema = z.object({
  name,
  kind,
  /** The opening valuation. Optional: a holding can be named before it is valued. */
  value: value.optional(),
  asOf: z.coerce.date({ error: "Pick a date" }).optional(),
  currency,
  note,
});

/**
 * Every field optional: absent means "leave as it is", explicit `null` means
 * "clear it". Values are deliberately absent here — worth is appended through
 * the valuations route, never edited in place.
 */
export const assetUpdateSchema = z.object({
  name: name.optional(),
  kind: kind.optional(),
  currency,
  note,
});

export const valuationCreateSchema = z.object({
  value,
  asOf: z.coerce.date({ error: "Pick a date" }),
});

/** Midnight UTC: a valuation describes a day, not a moment. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Last instant of today, UTC. */
export function endOfUtcDay(now = new Date()): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000 - 1);
}
