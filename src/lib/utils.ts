import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency: string = "USD",
  locale: string = "en-US"
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Grouping, symbol placement and date order for a workspace currency. Neither
 * `Profile` nor `Workspace` stores a locale, so without this a EUR workspace
 * reads "€1,234.56" instead of "1.234,56 €" and dates read "5 Aug 2026"
 * instead of "5. Aug. 2026". Derived rather than taken from the request so the
 * server and the client agree on the string.
 *
 * This is a stopgap, and wrong in principle: a Dutch user may well hold a USD
 * account, and currency is not nationality. Making it correct needs a real
 * preference, which is four changes rather than one:
 *
 *   1. `locale String @default("en-US")` on `Profile` in prisma/schema.prisma,
 *      plus a forward-only SQL bundle under prisma/migrations applied with
 *      `npm run db:apply` (see DEPLOYMENT.md).
 *   2. `locale` added to `profileSchema` in src/lib/validations/profile.ts and
 *      accepted by the PATCH handler in src/app/api/profile/route.ts.
 *   3. A picker beside the currency one in
 *      src/components/settings/currency-settings-form.tsx, so the column has a
 *      writer.
 *   4. The locale read alongside `currency` wherever a page resolves the
 *      workspace context, and passed to `formatCurrency` / `formatDate`
 *      directly — falling back to `localeForCurrency` when it is unset.
 *
 * Every call site below already takes the locale as an argument, so step 4 is
 * a substitution at the point the workspace is read and nothing deeper.
 */
const CURRENCY_LOCALES: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AUD: "en-AU",
  CAD: "en-CA",
  CHF: "de-CH",
  JPY: "ja-JP",
  NZD: "en-NZ",
};

export function localeForCurrency(currency: string | null | undefined): string {
  return CURRENCY_LOCALES[(currency ?? "").toUpperCase()] ?? "en-US";
}

export function formatDate(date: Date | string, locale: string = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

/** `formatDate` with the time of day, for stamps where the hour matters. */
export function formatDateTime(date: Date | string, locale: string = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getInitials(name?: string | null, email?: string | null) {
  if (name && name.trim().length > 0) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("");
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}
