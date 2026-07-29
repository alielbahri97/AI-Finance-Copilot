import type {
  ColumnMapping,
  DateFormat,
  NumberFormat,
  ParsedCsv,
  StatementCurrencyInfo,
} from "./types";

/** Currencies FinPilot can label amounts with (matches profile settings). */
const KNOWN_CURRENCY_CODES = new Set([
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
]);

const CURRENCY_SYMBOL_TO_CODE: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  "₣": "CHF",
};

/* ------------------------------------------------------------------ */
/* Number parsing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parses a localized amount string. Handles currency symbols, spaces and
 * apostrophes as grouping, parentheses and minus signs for negatives.
 *
 * Signs may appear before or after a currency symbol/code (e.g. `€-12,95`,
 * `$-4.50`, `EUR -12.95`). We capture any ASCII/Unicode minus before stripping
 * non-numeric characters — otherwise `€-12,95` would lose the sign and import
 * as income.
 *
 * Returns null when the value is not a number.
 */
export function parseLocalizedNumber(raw: string, format: NumberFormat): number | null {
  let value = raw.trim();
  if (value === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  // ASCII hyphen-minus or Unicode minus (U+2212), anywhere in the token.
  // Must run before stripping currency symbols so `€-12,95` / `$-4.50` keep sign.
  if (/[-−]/.test(value)) {
    negative = true;
  }

  // Strip currency symbols, letters, signs and whitespace/apostrophe grouping.
  value = value.replace(/[^\d.,]/g, "");
  if (value === "" || !/\d/.test(value)) return null;

  if (format === "eu") {
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return negative ? -parsed : parsed;
}

/** Detects US vs European number format by inspecting sample values. */
export function detectNumberFormat(samples: string[]): NumberFormat {
  let euVotes = 0;
  let usVotes = 0;

  for (const raw of samples) {
    const value = raw.replace(/[^\d.,]/g, "");
    if (!/\d/.test(value)) continue;

    const lastComma = value.lastIndexOf(",");
    const lastDot = value.lastIndexOf(".");

    if (lastComma >= 0 && lastDot >= 0) {
      // Both present: the later one is the decimal separator.
      if (lastComma > lastDot) euVotes++;
      else usVotes++;
    } else if (lastComma >= 0) {
      const digitsAfter = value.length - lastComma - 1;
      // ",12" decimal vs ",123" thousands grouping
      if (digitsAfter === 3 && value.split(",").length - 1 >= 1 && value.length > 4) {
        usVotes++;
      } else {
        euVotes++;
      }
    } else if (lastDot >= 0) {
      const digitsAfter = value.length - lastDot - 1;
      if (digitsAfter === 3 && value.length > 4) {
        euVotes++;
      } else {
        usVotes++;
      }
    }
  }

  return euVotes > usVotes ? "eu" : "us";
}

/* ------------------------------------------------------------------ */
/* Date parsing                                                        */
/* ------------------------------------------------------------------ */

const DATE_SPLIT = /[-./]/;

/** Parses a date string in the given layout, returning ISO `yyyy-mm-dd`. */
export function parseDateWithFormat(raw: string, format: DateFormat): string | null {
  const value = raw.trim();
  if (value === "") return null;

  let year: number, month: number, day: number;

  if (format === "compact") {
    if (!/^\d{8}$/.test(value)) return null;
    year = Number(value.slice(0, 4));
    month = Number(value.slice(4, 6));
    day = Number(value.slice(6, 8));
  } else {
    const parts = value.split(DATE_SPLIT).map((part) => part.trim());
    if (parts.length !== 3) return null;
    if (!parts.every((part) => /^\d{1,4}$/.test(part))) return null;
    const numbers = parts.map(Number);

    if (format === "ymd") {
      [year, month, day] = numbers;
    } else if (format === "dmy") {
      [day, month, year] = numbers;
    } else {
      [month, day, year] = numbers;
    }
  }

  if (year < 100) year += year > 70 ? 1900 : 2000;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Picks the date layout that successfully parses the most sample values.
 * Ambiguous day/month cases fall back to `preferred`.
 */
export function detectDateFormat(samples: string[], preferred: DateFormat = "dmy"): DateFormat {
  const candidates: DateFormat[] = ["ymd", "dmy", "mdy", "compact"];
  const scores = new Map<DateFormat, number>(candidates.map((format) => [format, 0]));

  for (const raw of samples) {
    for (const format of candidates) {
      if (parseDateWithFormat(raw, format) !== null) {
        scores.set(format, (scores.get(format) ?? 0) + 1);
      }
    }
  }

  const total = samples.filter((sample) => sample.trim() !== "").length;
  if (total === 0) return preferred;

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestFormat, bestScore] = ranked[0];
  if (bestScore === 0) return preferred;

  // If dmy and mdy tie (all values ambiguous, e.g. day <= 12), use preference.
  const dmyScore = scores.get("dmy") ?? 0;
  const mdyScore = scores.get("mdy") ?? 0;
  if (dmyScore === mdyScore && dmyScore === bestScore && (preferred === "dmy" || preferred === "mdy")) {
    return preferred;
  }

  return bestFormat;
}

/* ------------------------------------------------------------------ */
/* Column detection                                                    */
/* ------------------------------------------------------------------ */

const HEADER_KEYWORDS: Record<string, string[]> = {
  date: [
    "date", "datum", "booking", "boekdatum", "transactiedatum", "valutadatum",
    "posted", "buchungstag", "fecha", "transaction date",
  ],
  description: [
    "description", "omschrijving", "memo", "details", "narrative", "reference",
    "mededeling", "verwendungszweck", "concepto", "libellé", "libelle", "note",
    "transaction", "particulars",
  ],
  amount: ["amount", "bedrag", "betrag", "montant", "importe", "value", "transactiebedrag"],
  debit: ["debit", "debet", "af", "withdrawal", "uitgave", "soll", "paid out", "money out", "débit"],
  credit: ["credit", "bij", "deposit", "inkomst", "haben", "paid in", "money in", "crédit"],
  balance: ["balance", "saldo", "solde", "running balance"],
  counterparty: [
    "counterparty", "payee", "name", "naam", "tegenrekening", "tegenpartij",
    "merchant", "beneficiary", "payer", "empfänger", "iban", "account name",
    "naam tegenpartij", "counter account",
  ],
  currency: [
    "currency", "valuta", "munteenheid", "währung", "waehrung", "devise",
    "moneda", "ccy", "curr", "currency code", "iso currency",
  ],
};

function headerScore(header: string, role: keyof typeof HEADER_KEYWORDS): number {
  const value = header.toLowerCase().trim();
  if (value === "") return 0;
  let score = 0;
  for (const keyword of HEADER_KEYWORDS[role]) {
    if (value === keyword) score = Math.max(score, 3);
    else if (value.includes(keyword)) score = Math.max(score, 2);
  }
  return score;
}

function columnValues(rows: string[][], index: number, limit = 40): string[] {
  return rows.slice(0, limit).map((row) => row[index] ?? "").filter((value) => value.trim() !== "");
}

function fractionParsableAsDate(values: string[]): number {
  if (values.length === 0) return 0;
  const formats: DateFormat[] = ["ymd", "dmy", "mdy", "compact"];
  const parsable = values.filter((value) =>
    formats.some((format) => parseDateWithFormat(value, format) !== null)
  );
  return parsable.length / values.length;
}

function fractionParsableAsNumber(values: string[], format: NumberFormat): number {
  if (values.length === 0) return 0;
  const parsable = values.filter((value) => parseLocalizedNumber(value, format) !== null);
  return parsable.length / values.length;
}

/**
 * Suggests a column mapping for a parsed CSV using header keywords plus
 * value-shape analysis. Always returns a mapping; fields it cannot find are
 * null (the user corrects them in the preview step).
 */
export function suggestMapping(csv: ParsedCsv): ColumnMapping {
  const { headers, rows, columnCount } = csv;
  const indexes = Array.from({ length: columnCount }, (_, i) => i);

  // Number format from all numeric-looking cells.
  const numericSamples = rows
    .slice(0, 60)
    .flatMap((row) => row)
    .filter((cell) => /\d/.test(cell) && /^[\s\d.,+()€$£'-]*$/.test(cell));
  const numberFormat = detectNumberFormat(numericSamples);

  const dateFractions = indexes.map((i) => fractionParsableAsDate(columnValues(rows, i)));
  const numberFractions = indexes.map((i) =>
    fractionParsableAsNumber(columnValues(rows, i), numberFormat)
  );
  const avgLength = indexes.map((i) => {
    const values = columnValues(rows, i);
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value.length, 0) / values.length;
  });

  const score = (index: number, role: keyof typeof HEADER_KEYWORDS): number => {
    let total = headers ? headerScore(headers[index], role) * 2 : 0;
    if (role === "date") {
      total += dateFractions[index] * 4;
      if (numberFractions[index] > 0.9 && dateFractions[index] < 0.5) total -= 2;
    }
    if (role === "amount" || role === "debit" || role === "credit" || role === "balance") {
      total += numberFractions[index] * 3;
      // Dates also parse as numbers sometimes; penalize date-shaped columns.
      total -= dateFractions[index] * 3;
    }
    if (role === "description") {
      total += Math.min(avgLength[index] / 15, 2);
      total -= dateFractions[index] * 2;
      total -= numberFractions[index] * 2;
    }
    if (role === "counterparty") {
      total += Math.min(avgLength[index] / 20, 1);
      total -= dateFractions[index] * 2;
      total -= numberFractions[index] * 2;
    }
    return total;
  };

  const taken = new Set<number>();
  const pick = (role: keyof typeof HEADER_KEYWORDS, minScore: number): number | null => {
    let bestIndex: number | null = null;
    let bestScore = minScore;
    for (const index of indexes) {
      if (taken.has(index)) continue;
      const total = score(index, role);
      if (total > bestScore) {
        bestScore = total;
        bestIndex = index;
      }
    }
    if (bestIndex !== null) taken.add(bestIndex);
    return bestIndex;
  };

  // Order matters: strongly-typed columns first.
  const date = pick("date", 1.5);
  const debit = headers ? pick("debit", 3.5) : null;
  const credit = headers ? pick("credit", 3.5) : null;
  const hasPair = debit !== null && credit !== null;
  const amount = hasPair ? null : pick("amount", 1.5);
  const balance = pick("balance", headers ? 3.5 : 99); // only via header keywords
  const currency = pick("currency", headers ? 3.5 : 99); // only via header keywords
  const description = pick("description", 0.5);
  const counterparty = pick("counterparty", headers ? 3 : 99);

  // Date format from the chosen date column.
  const dateFormat =
    date !== null
      ? detectDateFormat(columnValues(rows, date), numberFormat === "eu" ? "dmy" : "mdy")
      : "ymd";

  return {
    date: date ?? 0,
    description: description ?? (indexes.find((i) => !taken.has(i)) ?? 0),
    amount,
    debit: hasPair ? debit : null,
    credit: hasPair ? credit : null,
    balance,
    counterparty,
    currency,
    numberFormat,
    dateFormat,
  };
}

/* ------------------------------------------------------------------ */
/* Statement currency                                                  */
/* ------------------------------------------------------------------ */

/** Extracts an ISO currency code from a cell (code or symbol). */
export function parseCurrencyCode(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  const upper = value.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && KNOWN_CURRENCY_CODES.has(upper)) {
    return upper;
  }

  // "EUR 12,95" / "Amount in USD"
  for (const code of KNOWN_CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    if (value.includes(symbol)) return code;
  }

  return null;
}

/**
 * Infers the statement currency from a Currency column and/or amount cells.
 * Mixed multi-currency files set `mixed: true` so the importer can skip
 * foreign-currency rows instead of silently summing them as one currency.
 */
export function detectStatementCurrency(
  csv: ParsedCsv,
  mapping: ColumnMapping
): StatementCurrencyInfo {
  const counts = new Map<string, number>();

  const tally = (code: string | null) => {
    if (!code) return;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };

  if (mapping.currency !== null) {
    for (const value of columnValues(csv.rows, mapping.currency, 200)) {
      tally(parseCurrencyCode(value));
    }
  }

  // Fall back to symbols/codes embedded in amount (and debit/credit) cells.
  if (counts.size === 0) {
    const amountIndexes = [mapping.amount, mapping.debit, mapping.credit].filter(
      (index): index is number => index !== null
    );
    for (const index of amountIndexes) {
      for (const value of columnValues(csv.rows, index, 80)) {
        tally(parseCurrencyCode(value));
      }
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const codes = ranked.map(([code]) => code);
  return {
    code: codes[0] ?? null,
    mixed: codes.length > 1,
    codes,
    columnIndex: mapping.currency,
  };
}
