import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import {
  excelSerialToIso,
  isDateNumberFormat,
  parseExcelWorkbook,
  parseSpreadsheetMarkup,
} from "@/lib/import/excel";
import { StatementParseError } from "@/lib/import/types";

type Cell = string | number | Date | null;

async function workbookBuffer(
  build: (workbook: ExcelJS.Workbook) => void
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const bytes = await workbook.xlsx.writeBuffer();
  return bytes as ArrayBuffer;
}

function sheetOf(rows: Cell[][], name = "Transactions") {
  return (workbook: ExcelJS.Workbook) => {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  };
}

describe("Excel serial dates", () => {
  it("converts serials to ISO dates", () => {
    expect(excelSerialToIso(25569)).toBe("1970-01-01");
    expect(excelSerialToIso(45292)).toBe("2024-01-01");
    expect(excelSerialToIso(45678)).toBe("2025-01-21");
    // Serials below 60 predate Excel's phantom 29 February 1900.
    expect(excelSerialToIso(1)).toBe("1900-01-01");
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
  });

  it("recognizes date number formats without mistaking money for one", () => {
    expect(isDateNumberFormat("dd/mm/yyyy")).toBe(true);
    expect(isDateNumberFormat("[$-409]d-mmm-yy")).toBe(true);
    expect(isDateNumberFormat("yyyy-mm-dd hh:mm")).toBe(true);
    expect(isDateNumberFormat("#,##0.00")).toBe(false);
    expect(isDateNumberFormat('#,##0.00 "USD"')).toBe(false);
    expect(isDateNumberFormat("General")).toBe(false);
    expect(isDateNumberFormat(undefined)).toBe(false);
  });
});

describe("XLSX parsing", () => {
  it("reads date cells and numeric amounts into the shared representation", async () => {
    const buffer = await workbookBuffer(
      sheetOf([
        ["Date", "Description", "Counterparty", "Amount", "Balance"],
        [new Date(Date.UTC(2026, 6, 15)), "Albert Heijn 1584", "AH BV", -12.95, 1487.05],
        [new Date(Date.UTC(2026, 6, 16)), "Salaris juli", "Optiver", 3250.5, 4737.55],
      ])
    );

    const statement = await parseExcelWorkbook(buffer);
    expect(statement.format).toBe("excel");
    expect(statement.source).toBe('Excel sheet "Transactions"');
    expect(statement.headers).toEqual(["Date", "Description", "Counterparty", "Amount", "Balance"]);
    expect(statement.rows[0][0]).toBe("2026-07-15");
    expect(statement.rows[0][3]).toBe("-12.95");

    const mapping = suggestMapping(statement);
    const normalized = normalizeRows(statement.rows, mapping);
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ok[0]).toMatchObject({
      date: "2026-07-15",
      type: "EXPENSE",
      amount: 12.95,
      counterparty: "AH BV",
      balance: 1487.05,
    });
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 3250.5 });
  });

  it("reads raw date serials carrying a date number format", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Sheet1");
      sheet.addRow(["Date", "Description", "Amount"]);
      const row = sheet.addRow([45292, "New year coffee", -4.5]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
    });

    const statement = await parseExcelWorkbook(buffer);
    expect(statement.rows[0][0]).toBe("2024-01-01");
  });

  it("drops title rows above the table and keeps float amounts exact", async () => {
    const buffer = await workbookBuffer(
      sheetOf([
        ["ACME BANK — account statement"],
        [],
        ["Date", "Memo", "Amount"],
        ["2026-07-01", "Coffee shop", -3.2],
        ["2026-07-02", "Book store", -15],
      ])
    );

    const statement = await parseExcelWorkbook(buffer);
    expect(statement.headers).toEqual(["Date", "Memo", "Amount"]);
    expect(statement.rows).toHaveLength(2);
    expect(statement.rows[0][2]).toBe("-3.2");
    expect(statement.rows[1][2]).toBe("-15");
  });

  it("picks the sheet holding the transactions", async () => {
    const buffer = await workbookBuffer((workbook) => {
      workbook.addWorksheet("Info").addRow(["Exported by ACME Bank"]);
      const sheet = workbook.addWorksheet("Mutaties");
      sheet.addRow(["Datum", "Omschrijving", "Bedrag"]);
      sheet.addRow(["01-07-2026", "Albert Heijn", "-12,95"]);
      sheet.addRow(["02-07-2026", "Salaris", "3.250,50"]);
    });

    const statement = await parseExcelWorkbook(buffer);
    expect(statement.source).toBe('Excel sheet "Mutaties"');

    const mapping = suggestMapping(statement);
    expect(mapping.numberFormat).toBe("eu");
    expect(mapping.dateFormat).toBe("dmy");
    const normalized = normalizeRows(statement.rows, mapping);
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 3250.5 });
  });

  it("rejects an empty workbook", async () => {
    const buffer = await workbookBuffer((workbook) => {
      workbook.addWorksheet("Sheet1");
    });
    await expect(parseExcelWorkbook(buffer)).rejects.toThrowError(StatementParseError);
  });

  it("rejects a file that is not a workbook", async () => {
    const bytes = new TextEncoder().encode("PK\u0003\u0004 not really a workbook");
    await expect(parseExcelWorkbook(bytes.buffer as ArrayBuffer)).rejects.toThrowError(
      /could not be opened/i
    );
  });
});

describe("markup exports disguised as .xls", () => {
  it("reads an HTML table", () => {
    const statement = parseSpreadsheetMarkup(
      `<html><body><table>
        <tr><th>Date</th><th>Description</th><th>Amount</th></tr>
        <tr><td>15/07/2026</td><td>Caf&eacute; du Parc</td><td>-9,50</td></tr>
        <tr><td>16/07/2026</td><td>Salary</td><td>2.500,00</td></tr>
      </table></body></html>`
    );

    expect(statement.format).toBe("excel");
    expect(statement.source).toBe("HTML table in an Excel export");
    expect(statement.headers).toEqual(["Date", "Description", "Amount"]);

    const normalized = normalizeRows(statement.rows, suggestMapping(statement));
    expect(normalized.ok[0]).toMatchObject({ type: "EXPENSE", amount: 9.5 });
    expect(normalized.ok[0]?.description).toBe("Café du Parc");
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 2500 });
  });

  it("reads an Excel 2003 XML spreadsheet, honouring ss:Index gaps", () => {
    const statement = parseSpreadsheetMarkup(
      `<?xml version="1.0"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
        <Worksheet ss:Name="Sheet1"><Table>
          <Row><Cell><Data ss:Type="String">Date</Data></Cell><Cell><Data ss:Type="String">Description</Data></Cell><Cell><Data ss:Type="String">Amount</Data></Cell></Row>
          <Row><Cell><Data ss:Type="String">2026-07-15</Data></Cell><Cell ss:Index="3"><Data ss:Type="Number">-12.95</Data></Cell></Row>
        </Table></Worksheet>
      </Workbook>`
    );

    expect(statement.source).toBe("Excel 2003 XML spreadsheet");
    expect(statement.rows[0]).toEqual(["2026-07-15", "", "-12.95"]);
  });

  it("rejects markup with no rows", () => {
    expect(() => parseSpreadsheetMarkup("<html><body><table></table></body></html>")).toThrowError(
      StatementParseError
    );
  });
});
