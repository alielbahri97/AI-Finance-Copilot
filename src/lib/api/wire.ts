/**
 * The JSON contract shared by every endpoint a native client calls.
 *
 * Two rules, both of which are expensive to change once an app is in the Play
 * Store and older versions keep running for months:
 *
 * MONEY IS A DECIMAL STRING. `"1234.56"`, never `1234.56`. A JSON number is an
 * IEEE 754 double on the other side of the wire — Kotlin parses it as `Double`
 * and 0.1 + 0.2 stops being 0.3 somewhere in a running total. A string parses
 * losslessly into `BigDecimal`, which is what money arithmetic needs.
 *
 * Minor units (an integer count of cents) were the alternative and are
 * rejected here: they only work if the reader knows the currency's exponent,
 * and that is not a constant. JPY has none, most currencies have two, a few
 * have three. The database stores `Decimal(14, 2)` for every currency, so a
 * "cents" contract would quietly be a hundred times wrong for a yen workspace.
 * A decimal string carries its own scale and needs no table.
 *
 * TIMESTAMPS ARE ISO 8601 IN UTC. `"2026-08-10T12:34:56.000Z"`, always with the
 * `Z`, always with milliseconds. Values that mean a calendar day rather than an
 * instant — a transaction's date, an invoice's due date — are stored at UTC
 * midnight and are sent in the same shape, so a client reads the first ten
 * characters and never has to guess whether an offset was implied.
 *
 * Everything that is not money stays a JSON number: counts, percentages, plan
 * limits, quota meters. They are small integers or ratios where a double is
 * exactly the right type, and stringifying them would only make them annoying.
 */

/** A monetary amount as it appears on the wire: a fixed-scale decimal string. */
export type MoneyString = string;

/** An instant as it appears on the wire: ISO 8601, UTC, milliseconds, `Z`. */
export type TimestampString = string;

/** Everything the database and the domain layer hand us for an amount. */
export type MoneyInput = { toFixed(digits: number): string } | string | number | null | undefined;

/**
 * Scale of every money field. Matches the `Decimal(14, 2)` columns, so the
 * string is the stored value rather than a rounded view of it.
 */
export const MONEY_SCALE = 2;

/**
 * Formats an amount for the wire.
 *
 * Prisma `Decimal` and JavaScript `number` both carry `toFixed`, and Decimal's
 * is exact, so the value is never routed through a float on the way out.
 */
export function money(value: MoneyInput): MoneyString {
  if (value === null || value === undefined) return zeroMoney();

  if (typeof value === "string") {
    const parsed = Number(value);
    return normalize(Number.isFinite(parsed) ? parsed.toFixed(MONEY_SCALE) : zeroMoney());
  }

  if (typeof value === "number") {
    return normalize(Number.isFinite(value) ? value.toFixed(MONEY_SCALE) : zeroMoney());
  }

  return normalize(value.toFixed(MONEY_SCALE));
}

/** Formats an amount that is genuinely absent as null rather than as zero. */
export function moneyOrNull(value: MoneyInput): MoneyString | null {
  if (value === null || value === undefined) return null;
  return money(value);
}

function zeroMoney(): MoneyString {
  return (0).toFixed(MONEY_SCALE);
}

/**
 * Negative zero is a real JavaScript value and `(-0.001).toFixed(2)` produces
 * "-0.00", which is a confusing thing to show someone. There is one zero.
 */
function normalize(formatted: string): MoneyString {
  return formatted === `-${zeroMoney()}` ? zeroMoney() : formatted;
}

/** Formats an instant for the wire. */
export function timestamp(value: Date | string | number): TimestampString {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

/**
 * Formats an instant that may be absent.
 *
 * An unparseable value is absent rather than fatal: `toISOString` throws on
 * one, and a single bad row is not a reason to fail the whole response.
 */
export function timestampOrNull(
  value: Date | string | number | null | undefined
): TimestampString | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * A money field paired with the currency it is denominated in.
 *
 * Used where the amount does not sit under something that already names a
 * currency, so a client never has to infer one from the workspace and get it
 * wrong for a foreign account.
 */
export interface MoneyAmount {
  amount: MoneyString;
  currency: string;
}

export function moneyAmount(value: MoneyInput, currency: string): MoneyAmount {
  return { amount: money(value), currency };
}
