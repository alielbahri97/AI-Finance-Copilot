import type { ParsedCsv } from "./types";

/**
 * Decodes a raw CSV upload. Tries strict UTF-8 first (with BOM stripping) and
 * falls back to Windows-1252, which covers the vast majority of bank exports.
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  let bytes = new Uint8Array(buffer);
  // Strip UTF-8 BOM.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  // UTF-16 LE/BE BOM.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Picks the delimiter that appears most consistently (same count per line,
 * counted outside quoted sections) across the first lines of the file.
 */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0).slice(0, 25);
  let best: { delimiter: string; score: number } = { delimiter: ",", score: -1 };

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const nonZero = counts.filter((count) => count > 0);
    if (nonZero.length === 0) continue;

    // Consistency: how many lines share the most common count.
    const frequency = new Map<number, number>();
    for (const count of nonZero) {
      frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    const [modeCount, modeFrequency] = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0];
    const coverage = nonZero.length / lines.length;
    const score = modeFrequency * coverage * (modeCount > 0 ? 1 : 0);
    if (score > best.score) {
      best = { delimiter, score };
    }
  }

  return best.delimiter;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

/** RFC 4180-style tokenizer: quoted fields, `""` escapes, CRLF/LF/CR endings. */
export function tokenizeCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0].trim() !== "") {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  // Flush the trailing row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== "") {
      rows.push(row);
    }
  }

  return rows;
}

const DATE_LIKE = /^\s*\d{1,4}[-./]\d{1,2}[-./]\d{1,4}\s*$|^\s*\d{8}\s*$/;
const NUMBER_LIKE = /^\s*[-+(]?\s*[\d.,\s']+\s*[-)]?\s*$/;

/**
 * Heuristic: a header row contains no dates and no numbers while at least
 * one of the following rows does.
 */
export function looksLikeHeader(first: string[], rest: string[][]): boolean {
  if (rest.length === 0) return true;
  const firstHasData = first.some(
    (cell) => DATE_LIKE.test(cell) || (NUMBER_LIKE.test(cell) && /\d/.test(cell))
  );
  if (firstHasData) return false;
  const restHasData = rest
    .slice(0, 5)
    .some((row) => row.some((cell) => DATE_LIKE.test(cell) || NUMBER_LIKE.test(cell)));
  return restHasData;
}

/** Full parse pipeline: decode, detect delimiter, tokenize, split header. */
export function parseCsv(buffer: ArrayBuffer): ParsedCsv {
  const text = decodeCsvBuffer(buffer);
  const delimiter = detectDelimiter(text);
  const allRows = tokenizeCsv(text, delimiter);
  if (allRows.length === 0) {
    return { headers: null, rows: [], delimiter, columnCount: 0 };
  }

  // Normalize ragged rows to the modal column count.
  const frequency = new Map<number, number>();
  for (const row of allRows) {
    frequency.set(row.length, (frequency.get(row.length) ?? 0) + 1);
  }
  const columnCount = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const uniform = allRows
    .filter((row) => row.length === columnCount)
    .map((row) => row.map((cell) => cell.trim()));

  if (uniform.length === 0) {
    return { headers: null, rows: [], delimiter, columnCount: 0 };
  }

  const [first, ...rest] = uniform;
  if (looksLikeHeader(first, rest)) {
    return { headers: first, rows: rest, delimiter, columnCount };
  }
  return { headers: null, rows: uniform, delimiter, columnCount };
}
