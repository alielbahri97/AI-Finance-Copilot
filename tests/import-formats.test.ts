import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  detectStatementFormat,
  isSupportedStatementFile,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/import/format";
import { parseStatement } from "@/lib/import/parse-statement";
import { StatementParseError } from "@/lib/import/types";

const CSV = ["Date,Description,Amount", "2026-07-01,Coffee shop,-3.20"].join("\n");

const MT940 = [
  ":20:940A",
  ":25:NL91ABNA0417164300",
  ":60F:C260701EUR100,00",
  ":61:260702C50,00NTRFDEPOSIT",
  ":62F:C260702EUR150,00",
].join("\r\n");

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function xlsxBuffer(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Date", "Description", "Amount"]);
  sheet.addRow(["2026-07-01", "Coffee shop", -3.2]);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

async function pdfBuffer(): Promise<ArrayBuffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  const rows = [
    ["01/07/2026", "COFFEE SHOP CENTRAL STATION", "-3.20"],
    ["02/07/2026", "ALBERT HEIJN 1584", "-12.95"],
    ["03/07/2026", "SALARIS OPTIVER", "3250.50"],
  ];
  rows.forEach((cells, index) => {
    cells.forEach((cell, column) => {
      page.drawText(cell, { x: [40, 120, 400][column], y: 780 - index * 18, size: 9, font });
    });
  });
  const bytes = await document.save();
  return bufferOf(bytes);
}

/** OLE2 compound file header: legacy .xls and encrypted OOXML workbooks. */
const OLE2 = new Uint8Array(512);
OLE2.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

async function rejection(fileName: string, buffer: ArrayBuffer): Promise<StatementParseError> {
  try {
    await parseStatement(fileName, buffer);
  } catch (error) {
    if (error instanceof StatementParseError) return error;
    throw error;
  }
  throw new Error("expected parseStatement to reject");
}

describe("statement format detection", () => {
  it("offers every supported extension to the file picker", () => {
    for (const extension of [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".pdf", ".mt940", ".940", ".sta"]) {
      expect(isSupportedStatementFile(`statement${extension}`)).toBe(true);
      expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(extension);
    }
    expect(isSupportedStatementFile("statement.docx")).toBe(false);
    expect(isSupportedStatementFile("statement")).toBe(false);
  });

  it("recognizes formats from their content, not just their name", async () => {
    expect(detectStatementFormat("export.csv", bytesOf(CSV))).toBe("csv");
    expect(detectStatementFormat("export.pdf", new Uint8Array(await pdfBuffer()))).toBe("pdf");
    expect(detectStatementFormat("export.xlsx", new Uint8Array(await xlsxBuffer()))).toBe("excel");
    // A bank that hands out MT940 under a .txt name.
    expect(detectStatementFormat("export.txt", bytesOf(MT940))).toBe("mt940");
    expect(detectStatementFormat("export.sta", bytesOf(MT940))).toBe("mt940");
    // A .xls that is really an HTML table stays with the Excel parser.
    expect(detectStatementFormat("export.xls", bytesOf("<html><table></table></html>"))).toBe(
      "excel"
    );
    expect(detectStatementFormat("export.xls", OLE2)).toBe("excel");
  });
});

describe("statement dispatch", () => {
  it("routes each format to its parser", async () => {
    expect((await parseStatement("export.csv", bufferOf(bytesOf(CSV)))).format).toBe("csv");
    expect((await parseStatement("export.xlsx", await xlsxBuffer())).format).toBe("excel");
    expect((await parseStatement("export.pdf", await pdfBuffer())).format).toBe("pdf");
    expect((await parseStatement("export.txt", bufferOf(bytesOf(MT940)))).format).toBe("mt940");
  });

  it("reads a .xls that is really an HTML table", async () => {
    const html =
      "<html><body><table><tr><th>Date</th><th>Memo</th><th>Amount</th></tr>" +
      "<tr><td>01/07/2026</td><td>Coffee shop</td><td>-3.20</td></tr></table></body></html>";
    const statement = await parseStatement("export.xls", bufferOf(bytesOf(html)));

    expect(statement.format).toBe("excel");
    expect(statement.source).toBe("HTML table in an Excel export");
  });

  it("reads a .xls that is really a delimited text export", async () => {
    const statement = await parseStatement("export.xls", bufferOf(bytesOf(CSV)));
    expect(statement.format).toBe("csv");
    expect(statement.source).toBe('CSV · "," separated');
  });

  it("rejects an unsupported extension before reading the file", async () => {
    const error = await rejection("contract.docx", bufferOf(bytesOf("anything")));
    expect(error.status).toBe(415);
    expect(error.message).toContain("CSV, Excel, PDF or MT940");
  });

  it("rejects an empty upload", async () => {
    const error = await rejection("export.csv", new ArrayBuffer(0));
    expect(error.status).toBe(400);
  });

  it("explains how to convert a legacy or encrypted .xls", async () => {
    const error = await rejection("export.xls", bufferOf(OLE2));
    expect(error.status).toBe(415);
    expect(error.message).toMatch(/save it as \.xlsx or CSV/i);
  });

  it("rejects a corrupt PDF with a readable message", async () => {
    const error = await rejection("export.pdf", bufferOf(bytesOf("%PDF-1.7 truncated download")));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/could not be opened as a PDF/i);
  });

  it("rejects a CSV with no data rows", async () => {
    const error = await rejection("export.csv", bufferOf(bytesOf("Date,Description,Amount\n")));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/No data rows/i);
  });
});
