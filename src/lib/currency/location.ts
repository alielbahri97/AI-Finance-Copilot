import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/validations/profile";

export type { SupportedCurrency };

/** ISO 3166-1 alpha-2 → preferred currency among supported codes. */
const COUNTRY_TO_CURRENCY: Record<string, SupportedCurrency> = {
  US: "USD",
  PR: "USD",
  GU: "USD",
  VI: "USD",
  AS: "USD",
  MP: "USD",
  CA: "CAD",
  GB: "GBP",
  UK: "GBP",
  IM: "GBP",
  JE: "GBP",
  GG: "GBP",
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  CH: "CHF",
  LI: "CHF",
  // Eurozone + common EUR-using territories
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  AD: "EUR",
  MC: "EUR",
  SM: "EUR",
  VA: "EUR",
  XK: "EUR",
  ME: "EUR",
};

/** Free-text location hints (country / city / demonym) → currency. */
const LOCATION_HINTS: Array<{ pattern: RegExp; currency: SupportedCurrency }> = [
  { pattern: /\b(united states|usa|u\.s\.a?\.?|america)\b/i, currency: "USD" },
  { pattern: /\b(canada|canadian|toronto|vancouver|montreal)\b/i, currency: "CAD" },
  { pattern: /\b(united kingdom|great britain|england|scotland|wales|london|uk)\b/i, currency: "GBP" },
  { pattern: /\b(australia|australian|sydney|melbourne|brisbane)\b/i, currency: "AUD" },
  { pattern: /\b(new zealand|auckland|wellington)\b/i, currency: "NZD" },
  { pattern: /\b(japan|japanese|tokyo|osaka)\b/i, currency: "JPY" },
  { pattern: /\b(switzerland|swiss|zurich|geneva|bern)\b/i, currency: "CHF" },
  {
    pattern:
      /\b(netherlands|holland|dutch|amsterdam|rotterdam|utrecht|eindhoven|den haag|the hague)\b/i,
    currency: "EUR",
  },
  {
    pattern:
      /\b(germany|german|deutschland|berlin|munich|hamburg|frankfurt|cologne|köln)\b/i,
    currency: "EUR",
  },
  { pattern: /\b(france|french|paris|lyon|marseille)\b/i, currency: "EUR" },
  { pattern: /\b(spain|spanish|madrid|barcelona|valencia)\b/i, currency: "EUR" },
  { pattern: /\b(italy|italian|rome|milan|napoli|naples)\b/i, currency: "EUR" },
  { pattern: /\b(belgium|belgian|brussels|antwerp|brugge)\b/i, currency: "EUR" },
  { pattern: /\b(ireland|irish|dublin)\b/i, currency: "EUR" },
  { pattern: /\b(portugal|portuguese|lisbon|porto)\b/i, currency: "EUR" },
  { pattern: /\b(austria|austrian|vienna|wien)\b/i, currency: "EUR" },
  { pattern: /\b(finland|finnish|helsinki)\b/i, currency: "EUR" },
  { pattern: /\b(greece|greek|athens)\b/i, currency: "EUR" },
  { pattern: /\b(luxembourg)\b/i, currency: "EUR" },
  { pattern: /\b(eurozone|euro area)\b/i, currency: "EUR" },
];

export function isSupportedCurrency(code: string | null | undefined): code is SupportedCurrency {
  return Boolean(code && (SUPPORTED_CURRENCIES as readonly string[]).includes(code));
}

/** Maps a 2-letter country code to a supported currency (defaults to USD). */
export function currencyFromCountryCode(countryCode: string | null | undefined): SupportedCurrency {
  if (!countryCode) return "USD";
  const code = countryCode.trim().toUpperCase();
  return COUNTRY_TO_CURRENCY[code] ?? "USD";
}

/**
 * Infers currency from a free-text city/country string users enter in
 * onboarding / business profile. Returns null when nothing matches.
 */
export function currencyFromLocationText(location: string | null | undefined): SupportedCurrency | null {
  if (!location?.trim()) return null;
  const text = location.trim();

  // Bare ISO country code
  if (/^[A-Za-z]{2}$/.test(text)) {
    const mapped = COUNTRY_TO_CURRENCY[text.toUpperCase()];
    return mapped ?? null;
  }

  // Explicit currency code typed into the location field
  const upper = text.toUpperCase();
  if (isSupportedCurrency(upper)) return upper;

  for (const hint of LOCATION_HINTS) {
    if (hint.pattern.test(text)) return hint.currency;
  }
  return null;
}

/** Best-effort currency from Accept-Language (e.g. en-GB → GBP, nl-NL → EUR). */
export function currencyFromAcceptLanguage(header: string | null | undefined): SupportedCurrency | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0]?.trim();
    if (!tag) continue;
    const region = tag.split("-")[1]?.toUpperCase();
    if (region && COUNTRY_TO_CURRENCY[region]) {
      return COUNTRY_TO_CURRENCY[region];
    }
    const lang = tag.split("-")[0]?.toLowerCase();
    if (lang === "ja") return "JPY";
    if (lang === "de" || lang === "fr" || lang === "nl" || lang === "it" || lang === "es" || lang === "pt") {
      return "EUR";
    }
  }
  return null;
}

/**
 * Detect preferred currency from request headers (Vercel/Cloudflare geo + locale).
 * Order: IP country → Accept-Language → USD.
 */
export function currencyFromRequestHeaders(headerBag: {
  get(name: string): string | null;
}): SupportedCurrency {
  const country = (
    headerBag.get("x-vercel-ip-country") ??
    headerBag.get("cf-ipcountry") ??
    headerBag.get("x-country-code")
  )?.trim().toUpperCase();

  if (country && country !== "XX" && country !== "T1" && COUNTRY_TO_CURRENCY[country]) {
    return COUNTRY_TO_CURRENCY[country];
  }

  return currencyFromAcceptLanguage(headerBag.get("accept-language")) ?? "USD";
}
