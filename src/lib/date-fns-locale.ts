import { de, enAU, enCA, enGB, enNZ, enUS, ja, type Locale } from "date-fns/locale";

/**
 * `date-fns` takes a locale *object*, not a BCP-47 tag, so a tag from
 * `localeForCurrency` (or, later, a stored preference) has to be resolved to
 * one of its bundles before it can be handed to `format` or
 * `formatDistanceToNow`.
 *
 * Kept out of `@/lib/utils` on purpose: that module is imported by nearly
 * every client component for `cn`, and these bundles would ride along into
 * every chunk with it.
 */
const LOCALES: Record<string, Locale> = {
  de,
  en: enUS,
  "en-AU": enAU,
  "en-CA": enCA,
  "en-GB": enGB,
  "en-NZ": enNZ,
  ja,
};

/**
 * Falls back through the base language before `en-US`, so a tag `date-fns`
 * has no bundle for still lands somewhere sensible — `de-CH` on `de` rather
 * than on English.
 */
export function dateFnsLocale(locale: string = "en-US"): Locale {
  return LOCALES[locale] ?? LOCALES[locale.split("-")[0]] ?? enUS;
}
