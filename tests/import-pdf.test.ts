import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import { parseAmountToken, parsePdfStatementText, readLeadingDate } from "@/lib/import/pdf-core";
import { parsePdfStatement } from "@/lib/import/pdf";
import { StatementParseError } from "@/lib/import/types";

/** Column x-offsets of a typical statement table. */
const COLUMNS = [40, 120, 400, 480];

async function statementPdf(lines: string[][]): Promise<ArrayBuffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);

  lines.forEach((cells, index) => {
    cells.forEach((cell, column) => {
      page.drawText(cell, { x: COLUMNS[column], y: 780 - index * 18, size: 9, font });
    });
  });

  const bytes = await document.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("PDF statement heuristics", () => {
  it("reads date, description, amount and running balance from a table layout", () => {
    const statement = parsePdfStatementText(
      [
        "ACME BANK",
        "Account statement 01/07/2026 - 31/07/2026",
        "Date Description Amount Balance",
        "01/07/2026 ALBERT HEIJN 1584 -12,95 1.487,05",
        "02/07/2026 SALARIS OPTIVER 3.250,50 4.737,55",
        "03/07/2026 SPOTIFY AB -10,99 4.726,56",
        "Closing balance 4.726,56",
      ].join("\n")
    );

    expect(statement.format).toBe("pdf");
    expect(statement.headers).toEqual(["Date", "Description", "Amount", "Balance"]);
    expect(statement.rows).toHaveLength(3);

    const normalized = normalizeRows(statement.rows, suggestMapping(statement));
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ok[0]).toMatchObject({
      date: "2026-07-01",
      description: "ALBERT HEIJN 1584",
      type: "EXPENSE",
      amount: 12.95,
      balance: 1487.05,
    });
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 3250.5 });
  });

  it("derives the direction of unsigned amounts from the running balance", () => {
    const statement = parsePdfStatementText(
      [
        "01/07/2026 ALBERT HEIJN 1584 12.95 1487.05",
        "02/07/2026 SALARIS OPTIVER 3250.50 4737.55",
        "03/07/2026 SPOTIFY AB 10.99 4726.56",
      ].join("\n")
    );

    const normalized = normalizeRows(statement.rows, suggestMapping(statement));
    expect(normalized.ok.map((row) => row.type)).toEqual(["EXPENSE", "INCOME", "EXPENSE"]);
  });

  it("continues a transaction over wrapped description lines", () => {
    const statement = parsePdfStatementText(
      [
        "15 Jan 2026 TRANSFER TO SAVINGS -250.00",
        "REF 8891 MONTHLY STANDING ORDER",
        "16 Jan 2026 TESCO STORES 3421 -18.40",
      ].join("\n")
    );

    expect(statement.rows[0][0]).toBe("2026-01-15");
    expect(statement.rows[0][1]).toBe("TRANSFER TO SAVINGS REF 8891 MONTHLY STANDING ORDER");
    expect(statement.rows[1][0]).toBe("2026-01-16");
  });

  it("does not mistake a date for an amount", () => {
    const statement = parsePdfStatementText("01.02.2026 03.02.2026 REMBOURSEMENT 42,00");
    expect(statement.rows).toEqual([["2026-02-01", "REMBOURSEMENT", "-42.00", ""]]);
  });

  it("reads signs written as brackets, trailing minus and CR/DR markers", () => {
    expect(parseAmountToken("(12.95)")).toEqual({ value: 12.95, sign: -1 });
    expect(parseAmountToken("1.234,56-")).toEqual({ value: 1234.56, sign: -1 });
    expect(parseAmountToken("250.00 CR")).toEqual({ value: 250, sign: 1 });
    expect(parseAmountToken("250.00 DR")).toEqual({ value: 250, sign: -1 });
    expect(parseAmountToken("€ 1 234,56")).toEqual({ value: 1234.56, sign: null });
    expect(parseAmountToken("not money")).toBeNull();
  });

  it("recognizes numeric and month-name dates at the start of a line", () => {
    expect(readLeadingDate("2026-07-15 Coffee")).toMatchObject({ raw: "2026-07-15" });
    expect(readLeadingDate("15 Jul 2026 Coffee")).toMatchObject({ iso: "2026-07-15" });
    expect(readLeadingDate("Jul 15, 2026 Coffee")).toMatchObject({ iso: "2026-07-15" });
    expect(readLeadingDate("Payment received 15/07/2026")).toBeNull();
  });

  it("fails with an actionable message when there is nothing to read", () => {
    expect(() =>
      parsePdfStatementText("Thank you for banking with us. Your statement is attached.")
    ).toThrowError(/No transactions could be read/i);
  });
});

describe("PDF text extraction", () => {
  it("rebuilds table rows from a generated statement PDF", async () => {
    const buffer = await statementPdf([
      ["ACME BANK"],
      ["Date", "Description", "Amount", "Balance"],
      ["01/07/2026", "ALBERT HEIJN 1584", "-12.95", "1487.05"],
      ["02/07/2026", "SALARIS OPTIVER", "3250.50", "4737.55"],
      ["03/07/2026", "SPOTIFY AB", "-10.99", "4726.56"],
    ]);

    const statement = await parsePdfStatement(buffer);
    expect(statement.format).toBe("pdf");
    expect(statement.rows).toHaveLength(3);

    const normalized = normalizeRows(statement.rows, suggestMapping(statement));
    expect(normalized.ok).toHaveLength(3);
    expect(normalized.ok[0]).toMatchObject({
      date: "2026-07-01",
      description: "ALBERT HEIJN 1584",
      type: "EXPENSE",
      amount: 12.95,
    });
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 3250.5 });
  });

  it("rejects an image-only PDF instead of importing nothing", async () => {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    const bytes = await document.save();
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    await expect(parsePdfStatement(buffer)).rejects.toThrowError(/no text layer/i);
  });

  it("rejects a corrupt PDF", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nnot actually a pdf");
    await expect(parsePdfStatement(bytes.buffer as ArrayBuffer)).rejects.toThrowError(
      StatementParseError
    );
  });
});
