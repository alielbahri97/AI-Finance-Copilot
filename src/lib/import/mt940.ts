import { StatementParseError } from "./types";
import type { ParsedStatement } from "./types";

const HEADERS = [
  "Date",
  "Entry date",
  "Description",
  "Counterparty",
  "Amount",
  "Currency",
  "Balance",
] as const;

interface StatementLine {
  valueDate: string;
  entryDate: string;
  amount: number;
  description: string;
  counterparty: string | null;
  balance: number | null;
}

interface TagRecord {
  tag: string;
  value: string;
}

/**
 * Strips the SWIFT envelope (`{1:…}{2:…}{4: … -}{5:…}`) some banks wrap MT940
 * text in. Files exported straight from online banking usually have none.
 */
function stripSwiftEnvelope(text: string): string {
  return text
    .replace(/\{5:[\s\S]*?\}\}/g, "")
    .replace(/\{[1-3]:[^}]*\}/g, "")
    .replace(/\{4:/g, "")
    .replace(/^-\}$/gm, "");
}

/** Splits MT940 text into `:tag:` records, folding continuation lines in. */
export function readTagRecords(text: string): TagRecord[] {
  const records: TagRecord[] = [];
  for (const rawLine of stripSwiftEnvelope(text).split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const match = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (match) {
      records.push({ tag: match[1], value: match[2] });
    } else if (records.length > 0) {
      records[records.length - 1].value += `\n${line}`;
    }
  }
  return records;
}

/** MT940 dates are `YYMMDD`; the century pivot matches the CSV date parser. */
function isoFromYymmdd(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const shortYear = Number(value.slice(0, 2));
  const year = shortYear > 70 ? 1900 + shortYear : 2000 + shortYear;
  return isoDate(year, Number(value.slice(2, 4)), Number(value.slice(4, 6)));
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The entry date carries no year (`MMDD`). It belongs to the value date's
 * year unless that would put the two more than half a year apart, which only
 * happens across a new-year boundary.
 */
function entryDateIso(mmdd: string | undefined, valueDateIso: string): string {
  if (!mmdd || !/^\d{4}$/.test(mmdd)) return "";
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2, 4));
  const valueYear = Number(valueDateIso.slice(0, 4));
  const halfYearMs = 183 * 86_400_000;
  const valueMs = Date.parse(`${valueDateIso}T00:00:00.000Z`);

  let best: string | null = null;
  for (const year of [valueYear, valueYear - 1, valueYear + 1]) {
    const candidate = isoDate(year, month, day);
    if (!candidate) continue;
    if (Math.abs(Date.parse(`${candidate}T00:00:00.000Z`) - valueMs) <= halfYearMs) {
      best = candidate;
      break;
    }
  }
  return best ?? "";
}

/** MT940 amounts use a comma decimal separator and never group thousands. */
export function parseMt940Amount(raw: string): number | null {
  if (!/^\d+(?:,\d*)?$/.test(raw)) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

const BALANCE_PATTERN = /^([CD])(\d{6})([A-Z]{3})(\d+(?:,\d*)?)$/;

function parseBalanceTag(value: string): { amount: number; currency: string } | null {
  const match = value.replace(/\s+/g, "").match(BALANCE_PATTERN);
  if (!match) return null;
  const amount = parseMt940Amount(match[4]);
  if (amount === null) return null;
  return { amount: match[1] === "D" ? -amount : amount, currency: match[3] };
}

/**
 * `:61:` — value date, optional entry date, debit/credit mark, optional funds
 * code, amount, transaction type and references. `RC`/`RD` are reversals and
 * therefore flip the sign of the credit/debit they undo.
 */
const LINE_PATTERN = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+(?:,\d*)?)([NSF][A-Z0-9]{3})?(.*)$/;

interface RawLine {
  valueDate: string;
  entryDate: string;
  amount: number;
  reference: string;
}

export function parseStatementLine(value: string): RawLine | null {
  const [head, ...supplementary] = value.split("\n");
  const match = head.trim().match(LINE_PATTERN);
  if (!match) return null;

  const valueDate = isoFromYymmdd(match[1]);
  const magnitude = parseMt940Amount(match[5]);
  if (!valueDate || magnitude === null) return null;

  const credit = match[3] === "C" || match[3] === "RD";
  const reference = [match[7], ...supplementary]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    valueDate,
    entryDate: entryDateIso(match[2], valueDate),
    amount: credit ? magnitude : -magnitude,
    reference,
  };
}

/* ------------------------------------------------------------------ */
/* :86: information to account owner                                   */
/* ------------------------------------------------------------------ */

export interface StatementInformation {
  description: string;
  counterparty: string | null;
}

/**
 * `:86:` is free text in most countries, `?NN?` subfields in German-speaking
 * ones and `/TAG/value` pairs for SEPA. Continuation lines wrap mid-field in
 * the structured dialects, so those are joined without a separator.
 */
export function parseStatementInformation(value: string): StatementInformation {
  const lines = value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const glued = lines.join("");
  const spaced = lines.join(" ").replace(/\s+/g, " ").trim();

  if (/\?\d{2}[^?]*\?\d{2}/.test(glued)) {
    const fields = new Map<string, string>();
    for (const match of glued.matchAll(/\?(\d{2})([^?]*)/g)) {
      fields.set(match[1], (fields.get(match[1]) ?? "") + match[2]);
    }
    const purpose = Array.from({ length: 10 }, (_, index) => fields.get(String(20 + index)) ?? "")
      .join("")
      .trim();
    const counterparty = `${fields.get("32") ?? ""}${fields.get("33") ?? ""}`.trim();
    const bookingText = (fields.get("00") ?? "").trim();
    return {
      description: purpose || bookingText || spaced,
      counterparty: counterparty === "" ? null : counterparty,
    };
  }

  if (/^\/[A-Z]{2,8}\//.test(glued)) {
    const parts = glued.split(/\/([A-Z]{2,8})\//);
    const fields = new Map<string, string>();
    for (let index = 1; index < parts.length; index += 2) {
      fields.set(parts[index], (parts[index + 1] ?? "").trim());
    }
    const description = fields.get("REMI") || fields.get("EREF") || fields.get("TRTP") || spaced;
    const counterparty = fields.get("NAME") ?? "";
    return {
      description: description.replace(/\s+/g, " ").trim(),
      counterparty: counterparty === "" ? null : counterparty,
    };
  }

  return { description: spaced, counterparty: null };
}

/* ------------------------------------------------------------------ */
/* Statement                                                           */
/* ------------------------------------------------------------------ */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Parses one or more MT940 statements into the shared row/header
 * representation. Amounts are emitted signed with a dot decimal separator and
 * dates as ISO, so the existing column detection maps them without guessing.
 */
export function parseMt940(text: string): ParsedStatement {
  const records = readTagRecords(text);
  if (records.length === 0) {
    throw new StatementParseError(
      "This file has no MT940 tags. Check that you downloaded the MT940/SWIFT statement rather than another export.",
      422
    );
  }

  const lines: StatementLine[] = [];
  let currency = "";
  let balance: number | null = null;
  let malformed = 0;
  let sawTransactionTag = false;

  for (const record of records) {
    if (record.tag === "20") {
      balance = null;
      continue;
    }
    if (record.tag === "60F" || record.tag === "60M") {
      const opening = parseBalanceTag(record.value);
      if (opening) {
        balance = opening.amount;
        currency = opening.currency;
      }
      continue;
    }
    if (record.tag === "62F" || record.tag === "62M") {
      const closing = parseBalanceTag(record.value);
      if (closing && currency === "") currency = closing.currency;
      continue;
    }
    if (record.tag === "61") {
      sawTransactionTag = true;
      const parsed = parseStatementLine(record.value);
      if (!parsed) {
        malformed++;
        continue;
      }
      if (balance !== null) balance = round(balance + parsed.amount);
      lines.push({
        valueDate: parsed.valueDate,
        entryDate: parsed.entryDate,
        description: parsed.reference,
        counterparty: null,
        amount: parsed.amount,
        balance,
      });
      continue;
    }
    if (record.tag === "86" && lines.length > 0) {
      const information = parseStatementInformation(record.value);
      const line = lines[lines.length - 1];
      if (information.description !== "") line.description = information.description;
      line.counterparty = information.counterparty;
    }
  }

  if (lines.length === 0) {
    throw new StatementParseError(
      sawTransactionTag
        ? `None of the ${malformed} transaction lines (:61:) in this MT940 file could be read. The file looks malformed — ask your bank to re-export it.`
        : "No transaction lines (:61:) were found in this MT940 file.",
      422
    );
  }

  return {
    format: "mt940",
    source: `MT940 statement${currency ? ` in ${currency}` : ""}`,
    delimiter: "",
    headers: [...HEADERS],
    columnCount: HEADERS.length,
    rows: lines.map((line) => [
      line.valueDate,
      line.entryDate,
      line.description,
      line.counterparty ?? "",
      line.amount.toFixed(2),
      currency,
      line.balance === null ? "" : line.balance.toFixed(2),
    ]),
  };
}
