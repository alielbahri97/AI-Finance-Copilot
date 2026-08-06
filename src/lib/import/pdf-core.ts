import { detectDateFormat, parseDateWithFormat } from "@/lib/csv/detect";
import type { DateFormat } from "@/lib/csv/types";

import { StatementParseError } from "./types";
import type { ParsedStatement } from "./types";

const HEADERS = ["Date", "Description", "Amount", "Balance"] as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const NUMERIC_DATE = /^(\d{1,4}[-./]\d{1,2}[-./]\d{2,4})(?![\d-./])/;
const DAY_MONTH_NAME = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{2,4})\b/;
const MONTH_NAME_DAY = /^([A-Za-z]{3,9})\.?[ -](\d{1,2}),?[ -](\d{2,4})\b/;

/**
 * Money as it appears in a statement: an optional sign or bracket, an
 * optional currency symbol, digits with optional grouping, and always two
 * decimals. The lookaround stops the pattern from biting a chunk out of a
 * date (`01.02.2026`) or a longer number.
 */
const AMOUNT_TOKEN =
  "(?<![\\d.,])([-+(]?\\s?[€$£]?\\s?\\d+(?:[.,'\\u00a0]\\d{3})*[.,]\\d{2}\\s?\\)?\\s?[-+]?(?:\\s?(?:CR|DR)\\b)?)(?![.,]?\\d)";

function amountTokens(text: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(AMOUNT_TOKEN, "gi"))];
}

const NOISE_LINE =
  /^(?:page\s+\d+|.*\bcontinued\b.*|-+|_+)$/i;

interface AmountToken {
  value: number;
  /** null when the statement gives no debit/credit signal for this amount. */
  sign: -1 | 1 | null;
}

/**
 * Reads one money token. The last `.` or `,` is the decimal separator (there
 * are always two decimals), so no file-wide number-format guess is needed.
 */
export function parseAmountToken(raw: string): AmountToken | null {
  const token = raw.trim();
  let sign: -1 | 1 | null = null;
  if (/^\(.*\)$/.test(token) || /[-−]/.test(token) || /\bDR\b/i.test(token)) sign = -1;
  else if (/^\+/.test(token) || /\bCR\b/i.test(token)) sign = 1;

  const digits = token.replace(/[^\d.,]/g, "");
  const separator = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  if (separator === -1) return null;
  const normalized = `${digits.slice(0, separator).replace(/[.,]/g, "")}.${digits.slice(separator + 1)}`;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  return { value, sign };
}

function isoFromMonthName(day: number, monthName: string, year: number): string | null {
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (!month) return null;
  const fullYear = year < 100 ? (year > 70 ? 1900 + year : 2000 + year) : year;
  if (fullYear < 1900 || fullYear > 2200 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

interface LeadingDate {
  /** Raw numeric token, kept for file-wide layout detection. */
  raw: string | null;
  /** Already resolved for month-name dates. */
  iso: string | null;
  rest: string;
}

/** Pulls a date off the front of a line, if there is one. */
export function readLeadingDate(line: string): LeadingDate | null {
  const numeric = line.match(NUMERIC_DATE);
  if (numeric) {
    return { raw: numeric[1], iso: null, rest: line.slice(numeric[0].length) };
  }
  const dayFirst = line.match(DAY_MONTH_NAME);
  if (dayFirst) {
    const iso = isoFromMonthName(Number(dayFirst[1]), dayFirst[2], Number(dayFirst[3]));
    if (iso) return { raw: null, iso, rest: line.slice(dayFirst[0].length) };
  }
  const monthFirst = line.match(MONTH_NAME_DAY);
  if (monthFirst) {
    const iso = isoFromMonthName(Number(monthFirst[2]), monthFirst[1], Number(monthFirst[3]));
    if (iso) return { raw: null, iso, rest: line.slice(monthFirst[0].length) };
  }
  return null;
}

interface Candidate {
  rawDate: string | null;
  isoDate: string | null;
  description: string;
  amount: AmountToken;
  balance: number | null;
}

function cleanDescription(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s|;:,–—-]+|[\s|;:,–—-]+$/g, "")
    .trim();
}

/**
 * Walks the statement text line by line. A line that starts with a date and
 * ends in money is a transaction; when two or more amounts are present the
 * last one is the running balance. Lines without a date continue the
 * description of the transaction above them.
 */
function collectCandidates(lines: string[]): Candidate[] {
  const candidates: Candidate[] = [];

  for (const line of lines) {
    if (NOISE_LINE.test(line)) continue;

    const leading = readLeadingDate(line);
    if (!leading) {
      const previous = candidates[candidates.length - 1];
      if (previous && amountTokens(line).length === 0 && previous.description.length < 300) {
        previous.description = cleanDescription(`${previous.description} ${line}`);
      }
      continue;
    }

    // Statements often print a value date and a booking date side by side.
    let rest = leading.rest;
    const second = readLeadingDate(rest.trimStart());
    if (second) rest = second.rest;

    const tokens = amountTokens(rest);
    if (tokens.length === 0) continue;

    const parsed = tokens
      .map((match) => ({ match, amount: parseAmountToken(match[1]) }))
      .filter(
        (entry): entry is { match: RegExpMatchArray; amount: AmountToken } => entry.amount !== null
      );
    if (parsed.length === 0) continue;

    const balance = parsed.length > 1 ? parsed[parsed.length - 1].amount : null;
    const amount = parsed.length > 1 ? parsed[parsed.length - 2].amount : parsed[0].amount;

    let description = rest;
    for (const entry of parsed) description = description.replace(entry.match[0], " ");

    candidates.push({
      rawDate: leading.raw,
      isoDate: leading.iso,
      description: cleanDescription(description),
      amount,
      balance: balance ? balance.value * (balance.sign ?? 1) : null,
    });
  }

  return candidates;
}

/**
 * Fills in the direction of amounts the statement printed without a sign, by
 * following the running balance. Anything still undecided falls back to an
 * expense, which is what the overwhelming majority of statement lines are —
 * the preview step is there for the user to catch the rest.
 */
function resolveSigns(candidates: Candidate[]): void {
  for (let index = 1; index < candidates.length; index++) {
    const current = candidates[index];
    if (current.amount.sign !== null) continue;
    const previousBalance = candidates[index - 1].balance;
    if (previousBalance === null || current.balance === null) continue;
    const delta = current.balance - previousBalance;
    if (Math.abs(delta - current.amount.value) < 0.005) current.amount.sign = 1;
    else if (Math.abs(delta + current.amount.value) < 0.005) current.amount.sign = -1;
  }
  for (const candidate of candidates) {
    if (candidate.amount.sign === null) candidate.amount.sign = -1;
  }
}

function resolveDateFormat(candidates: Candidate[]): DateFormat {
  const samples = candidates
    .map((candidate) => candidate.rawDate)
    .filter((value): value is string => value !== null);
  return detectDateFormat(samples);
}

/**
 * Turns the text layer of a bank statement PDF into the shared row/header
 * representation. Best-effort by nature: it feeds the normal preview step so
 * the user confirms (and corrects) everything before anything is stored.
 */
export function parsePdfStatementText(text: string): ParsedStatement {
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter((line) => line !== "");

  const candidates = collectCandidates(lines);
  if (candidates.length === 0) {
    throw new StatementParseError(
      "No transactions could be read from this PDF. Statements laid out as a table of date, description and amount work best — if your bank also offers CSV, Excel or MT940, those import reliably.",
      422
    );
  }

  resolveSigns(candidates);
  const dateFormat = resolveDateFormat(candidates);

  const rows: string[][] = [];
  for (const candidate of candidates) {
    const date =
      candidate.isoDate ??
      (candidate.rawDate ? parseDateWithFormat(candidate.rawDate, dateFormat) : null);
    if (!date) continue;
    rows.push([
      date,
      candidate.description || "Statement line",
      (candidate.amount.value * (candidate.amount.sign ?? -1)).toFixed(2),
      candidate.balance === null ? "" : candidate.balance.toFixed(2),
    ]);
  }

  if (rows.length === 0) {
    throw new StatementParseError(
      "Dates on this PDF's transaction lines could not be interpreted. If your bank also offers CSV, Excel or MT940, those import reliably.",
      422
    );
  }

  return {
    format: "pdf",
    source: `PDF statement (${rows.length} line${rows.length === 1 ? "" : "s"} detected)`,
    delimiter: "",
    headers: [...HEADERS],
    columnCount: HEADERS.length,
    rows,
  };
}
