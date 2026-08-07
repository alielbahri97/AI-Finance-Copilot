import { decodeCsvBuffer, parseCsv } from "@/lib/csv/parse";

import {
  looksLikeSpreadsheetMarkup,
  parseExcelWorkbook,
  parseLegacyExcelWorkbook,
  parseSpreadsheetMarkup,
} from "./excel";
import {
  ACCEPTED_FORMATS_SENTENCE,
  detectStatementFormat,
  isOle2Container,
  isSupportedStatementFile,
  isZipContainer,
} from "./format";
import { parseMt940 } from "./mt940";
import { parsePdfStatement } from "./pdf";
import { StatementParseError } from "./types";
import type { ParsedStatement } from "./types";

function parseDelimited(buffer: ArrayBuffer): ParsedStatement {
  const csv = parseCsv(buffer);
  if (csv.rows.length === 0) {
    throw new StatementParseError(
      "No data rows were found. Check that this is a real CSV/TSV export from your bank.",
      422
    );
  }
  return {
    ...csv,
    format: "csv",
    source: `CSV · ${csv.delimiter === "\t" ? "tab" : `"${csv.delimiter}"`} separated`,
  };
}

/**
 * `.xls` covers three very different things in practice: real OOXML zipped
 * workbooks, the HTML/SpreadsheetML tables most banks actually emit, and the
 * genuine binary 97-2003 format (parsed via SheetJS).
 */
async function parseExcelLike(buffer: ArrayBuffer, bytes: Uint8Array): Promise<ParsedStatement> {
  if (isZipContainer(bytes)) return parseExcelWorkbook(buffer);
  if (isOle2Container(bytes)) return parseLegacyExcelWorkbook(buffer);
  const text = decodeCsvBuffer(buffer);
  if (looksLikeSpreadsheetMarkup(text)) return parseSpreadsheetMarkup(text);
  return parseDelimited(buffer);
}

/**
 * Single entry point for uploaded statements. Detects the format, runs the
 * matching parser and returns the one representation the rest of the import
 * pipeline understands. Every failure is a `StatementParseError` carrying a
 * message and status the API routes can hand straight to the user.
 */
export async function parseStatement(
  fileName: string,
  buffer: ArrayBuffer
): Promise<ParsedStatement> {
  if (buffer.byteLength === 0) {
    throw new StatementParseError("The file is empty", 400);
  }
  if (!isSupportedStatementFile(fileName)) {
    throw new StatementParseError(
      `"${fileName}" is not a supported statement file. Upload a ${ACCEPTED_FORMATS_SENTENCE} export.`,
      415
    );
  }

  const bytes = new Uint8Array(buffer);
  switch (detectStatementFormat(fileName, bytes)) {
    case "pdf":
      return parsePdfStatement(buffer);
    case "excel":
      return parseExcelLike(buffer, bytes);
    case "mt940":
      return parseMt940(decodeCsvBuffer(buffer));
    default:
      return parseDelimited(buffer);
  }
}
