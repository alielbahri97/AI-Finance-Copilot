import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

import { buildGrid } from "./grid";
import { StatementParseError } from "./types";
import type { ParsedStatement } from "./types";

/** 1899-12-30, the day Excel's serial 0 refers to under the 1900 date system. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
/** Serial 2958465 is 9999-12-31; anything beyond is not a date. */
const MAX_EXCEL_SERIAL = 2_958_465;

/**
 * Converts an Excel date serial to ISO `yyyy-mm-dd`. Serials below 60 are
 * shifted by a day to undo Excel's phantom 29 February 1900.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > MAX_EXCEL_SERIAL) return null;
  const days = Math.floor(serial) + (serial < 60 ? 1 : 0);
  return new Date(EXCEL_EPOCH_MS + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * True for number formats that render a date or time (`dd/mm/yyyy`,
 * `[$-409]d-mmm-yy`, …). Literals in quotes and locale/colour sections are
 * removed first so `#,##0.00 "USD"` is not mistaken for a date.
 */
export function isDateNumberFormat(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  const stripped = numFmt
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[dmy]/i.test(stripped);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  // Excel stores 12.34 as 12.339999999999999; 6 decimals is plenty for money.
  return String(Math.round(value * 1e6) / 1e6);
}

function cellToString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    return isDateNumberFormat(cell.numFmt)
      ? (excelSerialToIso(value) ?? formatNumber(value))
      : formatNumber(value);
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  if (typeof value === "object") {
    if ("error" in value) return "";
    if ("richText" in value) return cell.text.trim();
    if ("text" in value) return String(value.text).trim();
    if ("result" in value) {
      const result = value.result;
      if (result === null || result === undefined) return "";
      if (result instanceof Date) return result.toISOString().slice(0, 10);
      if (typeof result === "number") {
        return isDateNumberFormat(cell.numFmt)
          ? (excelSerialToIso(result) ?? formatNumber(result))
          : formatNumber(result);
      }
      if (typeof result === "object" && "error" in result) return "";
      return String(result).trim();
    }
  }

  return cell.text.trim();
}

function sheetToRows(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell));
    });
    rows.push(cells);
  });
  return rows;
}

/** Rows holding at least two filled cells — the shape of an actual table row. */
function tableRowCount(rows: string[][]): number {
  return rows.filter((row) => row.filter((cell) => cell.trim() !== "").length >= 2).length;
}

/**
 * Reads an OOXML workbook (.xlsx/.xlsm) and returns the sheet that looks most
 * like a statement — the one with the most populated rows.
 */
export async function parseExcelWorkbook(buffer: ArrayBuffer): Promise<ParsedStatement> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs resolves `Buffer` against the @types/node@14 its fast-csv
    // dependency drags in, which no longer matches the modern Buffer type.
    const data = Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(data);
  } catch {
    throw new StatementParseError(
      "This Excel file could not be opened. If it is password-protected, remove the password and upload it again; otherwise re-save it as .xlsx or CSV.",
      422
    );
  }

  const sheets = workbook.worksheets.filter((sheet) => sheet.state !== "veryHidden");
  if (sheets.length === 0) {
    throw new StatementParseError("This workbook has no sheets.", 422);
  }

  let best: { sheet: ExcelJS.Worksheet; rows: string[][]; score: number } | null = null;
  for (const sheet of sheets) {
    const rows = sheetToRows(sheet);
    const score = tableRowCount(rows);
    if (!best || score > best.score) best = { sheet, rows, score };
  }
  if (!best || best.score === 0) {
    throw new StatementParseError(
      "No transaction rows were found in this workbook — every sheet is empty.",
      422
    );
  }

  const grid = buildGrid(best.rows);
  if (grid.rows.length === 0) {
    throw new StatementParseError(
      `The sheet "${best.sheet.name}" has no data rows below its header.`,
      422
    );
  }

  return {
    ...grid,
    delimiter: "",
    format: "excel",
    source: `Excel sheet "${best.sheet.name}"`,
  };
}

function formatSheetJsCell(value: XLSX.CellObject["v"], cell: XLSX.CellObject): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const numFmt = typeof cell.z === "string" ? cell.z : undefined;
    if (cell.t === "d" || isDateNumberFormat(numFmt)) {
      return excelSerialToIso(value) ?? formatNumber(value);
    }
    return formatNumber(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
}

function sheetJsRows(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    const cells: string[] = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      cells.push(cell ? formatSheetJsCell(cell.v, cell) : "");
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Reads a real Excel 97-2003 (BIFF) workbook. Password-protected OLE2 packages
 * and truncated files fall through to a clear conversion message.
 */
export async function parseLegacyExcelWorkbook(buffer: ArrayBuffer): Promise<ParsedStatement> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(buffer), {
      type: "buffer",
      cellDates: true,
      dense: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt|CFB|compound/i.test(message)) {
      throw new StatementParseError(
        "This Excel file is password-protected. Remove the password and upload it again, or re-save it as .xlsx or CSV.",
        415
      );
    }
    throw new StatementParseError(
      "This legacy Excel workbook could not be opened. Re-save it as .xlsx or CSV in Excel, LibreOffice or Google Sheets, then upload that file.",
      415
    );
  }

  const hiddenByName = new Map(
    (workbook.Workbook?.Sheets ?? []).map((meta) => [meta.name, meta.Hidden ?? 0])
  );
  const sheetNames = workbook.SheetNames.filter((name) => {
    if (!workbook.Sheets[name]) return false;
    // 0 = visible, 1 = hidden, 2 = very hidden
    return (hiddenByName.get(name) ?? 0) === 0;
  });
  if (sheetNames.length === 0) {
    throw new StatementParseError("This workbook has no sheets.", 422);
  }

  let best: { name: string; rows: string[][]; score: number } | null = null;
  for (const name of sheetNames) {
    const rows = sheetJsRows(workbook.Sheets[name]);
    const score = tableRowCount(rows);
    if (!best || score > best.score) best = { name, rows, score };
  }
  if (!best || best.score === 0) {
    throw new StatementParseError(
      "No transaction rows were found in this workbook — every sheet is empty.",
      422
    );
  }

  const grid = buildGrid(best.rows);
  if (grid.rows.length === 0) {
    throw new StatementParseError(
      `The sheet "${best.name}" has no data rows below its header.`,
      422
    );
  }

  return {
    ...grid,
    delimiter: "",
    format: "excel",
    source: `Excel 97-2003 sheet "${best.name}"`,
  };
}

/* ------------------------------------------------------------------ */
/* Markup-based "Excel" exports                                        */
/* ------------------------------------------------------------------ */

/** HTML 4 Latin-1 entity names, in code-point order from U+00A0 (`&nbsp;`). */
const LATIN1_ENTITIES =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " "
  );

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["euro", "€"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["rsquo", "’"],
  ["hellip", "…"],
  ...LATIN1_ENTITIES.map(
    (name, index): [string, string] => [name, String.fromCodePoint(0xa0 + index)]
  ),
]);

function decodeMarkupText(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) =>
        NAMED_ENTITIES.get(name) ?? NAMED_ENTITIES.get(name.toLowerCase()) ?? match
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** True for the two markup dialects banks ship under an `.xls` extension. */
export function looksLikeSpreadsheetMarkup(text: string): boolean {
  return /<table[\s>]/i.test(text) || isSpreadsheetMl(text);
}

/** SpreadsheetML also uses a `<Table>` element, so it has to be ruled out first. */
function isSpreadsheetMl(text: string): boolean {
  return (
    /<Worksheet[\s>]/i.test(text) || /urn:schemas-microsoft-com:office:spreadsheet/i.test(text)
  );
}

function htmlTableRows(text: string): string[][] {
  let best: string[][] = [];
  for (const table of text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows: string[][] = [];
    for (const row of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cells.push(decodeMarkupText(cell[1]));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > best.length) best = rows;
  }
  return best;
}

function spreadsheetMlRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const row of text.matchAll(/<Row[^>]*>([\s\S]*?)<\/Row>/gi)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<Cell([^>]*)>([\s\S]*?)<\/Cell>/gi)) {
      // ss:Index skips empty columns, so pad up to the declared position.
      const index = cell[1].match(/ss:Index\s*=\s*"(\d+)"/i);
      if (index) {
        while (cells.length < Number(index[1]) - 1) cells.push("");
      }
      const data = cell[2].match(/<Data[^>]*>([\s\S]*?)<\/Data>/i);
      cells.push(decodeMarkupText(data ? data[1] : cell[2]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Parses the HTML tables and SpreadsheetML 2003 documents that many banks
 * hand out as `.xls`. Both are plain text, so neither needs a binary reader.
 */
export function parseSpreadsheetMarkup(text: string): ParsedStatement {
  const isHtml = !isSpreadsheetMl(text);
  const rows = isHtml ? htmlTableRows(text) : spreadsheetMlRows(text);
  const grid = buildGrid(rows);
  if (grid.rows.length === 0) {
    throw new StatementParseError(
      "No transaction rows were found in this file. Re-export the statement as .xlsx or CSV and try again.",
      422
    );
  }

  return {
    ...grid,
    delimiter: "",
    format: "excel",
    source: isHtml ? "HTML table in an Excel export" : "Excel 2003 XML spreadsheet",
  };
}
