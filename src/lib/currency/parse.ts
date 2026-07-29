/** Currencies FinPilot can label amounts with (matches profile + invoice settings). */
export const KNOWN_CURRENCY_CODES = new Set([
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "INR",
  "CNY",
  "HKD",
  "SGD",
  "NZD",
  "MXN",
  "BRL",
  "ZAR",
  "AED",
]);

/** Sorted ISO codes for invoice currency dropdowns. */
export const INVOICE_CURRENCY_OPTIONS = [...KNOWN_CURRENCY_CODES].sort();

const CURRENCY_SYMBOL_TO_CODE: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  "₣": "CHF",
  A$: "AUD",
  C$: "CAD",
  NZ$: "NZD",
  R$: "BRL",
};

const CURRENCY_NAME_HINTS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\beuros?\b/i, code: "EUR" },
  { pattern: /\bpounds?\b|\bst(?:erling)?\b/i, code: "GBP" },
  { pattern: /\bdollars?\b/i, code: "USD" },
  { pattern: /\byen\b/i, code: "JPY" },
  { pattern: /\bswiss\s+francs?\b|\bfrancs?\b/i, code: "CHF" },
  { pattern: /\baustralian\s+dollars?\b/i, code: "AUD" },
  { pattern: /\bcanadian\s+dollars?\b/i, code: "CAD" },
];

/** Extracts an ISO currency code from a cell, amount, or invoice snippet. */
export function parseCurrencyCode(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  const upper = value.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && KNOWN_CURRENCY_CODES.has(upper)) {
    return upper;
  }

  // Prefer multi-char symbols before bare `$`.
  for (const symbol of ["NZ$", "A$", "C$", "R$"]) {
    if (value.includes(symbol)) return CURRENCY_SYMBOL_TO_CODE[symbol];
  }

  // "EUR 12,95" / "Amount in USD"
  for (const code of KNOWN_CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }

  for (const hint of CURRENCY_NAME_HINTS) {
    if (hint.pattern.test(value)) return hint.code;
  }

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    if (symbol.length === 1 && value.includes(symbol)) return code;
  }

  return null;
}

/**
 * Scans free text (PDF layer, OCR notes, filename) for the most likely
 * currency code. Returns null when nothing recognizable appears.
 */
export function detectCurrencyInText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;

  const counts = new Map<string, number>();
  const tally = (code: string | null) => {
    if (!code) return;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };

  // Whole-document symbol/code scan
  tally(parseCurrencyCode(text));

  // Line-by-line for denser tallies (headers like "Currency: EUR")
  for (const line of text.split(/\r?\n/).slice(0, 80)) {
    tally(parseCurrencyCode(line));
  }

  // Explicit ISO codes with word boundaries across the blob
  for (const code of KNOWN_CURRENCY_CODES) {
    const matches = text.toUpperCase().match(new RegExp(`\\b${code}\\b`, "g"));
    if (matches) counts.set(code, (counts.get(code) ?? 0) + matches.length);
  }

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    if (symbol.length > 1) continue;
    let index = text.indexOf(symbol);
    let n = 0;
    while (index !== -1 && n < 20) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
      index = text.indexOf(symbol, index + 1);
      n += 1;
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

/** Prefer extracted → document text → profile fallback. */
export function resolveInvoiceCurrency(options: {
  extracted?: string | null;
  documentText?: string | null;
  fallback: string;
}): string {
  const fromExtracted = options.extracted
    ? parseCurrencyCode(options.extracted) ??
      (/^[A-Z]{3}$/i.test(options.extracted.trim())
        ? options.extracted.trim().toUpperCase()
        : null)
    : null;
  if (fromExtracted) return fromExtracted;

  const fromText = detectCurrencyInText(options.documentText);
  if (fromText) return fromText;

  const fromFallback = parseCurrencyCode(options.fallback);
  return fromFallback ?? (options.fallback.toUpperCase().slice(0, 3) || "USD");
}
