import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { detectStatementCurrency, parseLocalizedNumber, suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import { parseCsv } from "@/lib/csv/parse";

function analyze(csvText: string, expectedCurrency?: string | null) {
  const buffer = new TextEncoder().encode(csvText).buffer as ArrayBuffer;
  const csv = parseCsv(buffer);
  const mapping = suggestMapping(csv);
  const statementCurrency = detectStatementCurrency(csv, mapping);
  const normalized = normalizeRows(csv.rows, mapping, {
    expectedCurrency:
      expectedCurrency !== undefined
        ? expectedCurrency
        : mapping.currency !== null
          ? statementCurrency.code
          : null,
  });
  return { csv, mapping, normalized, statementCurrency };
}

describe("CSV parsing and column detection", () => {
  it("handles US bank exports (comma, mm/dd/yyyy, signed amounts, quoted fields)", () => {
    const { csv, mapping, normalized } = analyze(
      [
        "Date,Description,Amount,Balance",
        '07/15/2026,"STARBUCKS #123, SEATTLE",-4.50,"1,234.56"',
        "07/16/2026,PAYCHECK ACME INC,2500.00,3734.56",
      ].join("\r\n")
    );

    expect(csv.delimiter).toBe(",");
    expect(csv.headers?.[0]).toBe("Date");
    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBe(2);
    expect(mapping.balance).toBe(3);
    expect(mapping.dateFormat).toBe("mdy");
    expect(mapping.numberFormat).toBe("us");

    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok[0]).toMatchObject({ type: "EXPENSE", amount: 4.5, date: "2026-07-15" });
    expect(normalized.ok[0]?.description).toContain("SEATTLE");
    expect(normalized.ok[0]?.balance).toBe(1234.56);
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 2500 });
  });

  it("handles EU bank exports (semicolon, dd-mm-yyyy, debit/credit pair)", () => {
    const { csv, mapping, normalized } = analyze(
      [
        "Boekdatum;Omschrijving;Naam tegenpartij;Af;Bij;Saldo",
        "15-07-2026;Albert Heijn 1584;AH BV;12,95;;1.500,00",
        "16-07-2026;Salaris juli;Optiver;;3.250,50;4.750,50",
      ].join("\n")
    );

    expect(csv.delimiter).toBe(";");
    expect(mapping.debit).toBe(3);
    expect(mapping.credit).toBe(4);
    expect(mapping.counterparty).toBe(2);
    expect(mapping.numberFormat).toBe("eu");
    expect(mapping.dateFormat).toBe("dmy");

    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok[0]).toMatchObject({ type: "EXPENSE", amount: 12.95, balance: 1500 });
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 3250.5 });
  });

  it("handles headerless TSV with ISO dates", () => {
    const { csv, mapping, normalized } = analyze(
      ["2026-07-01\tCoffee shop\t-3.20", "2026-07-02\tBook store\t-15.00"].join("\n")
    );

    expect(csv.delimiter).toBe("\t");
    expect(csv.headers).toBeNull();
    expect(mapping.dateFormat).toBe("ymd");
    expect(normalized.ok).toHaveLength(2);
  });

  it("decodes Windows-1252 encoded files", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("Date,Description,Amount\n2026-07-01,Caf"),
      0xe9, // é in windows-1252
      ...new TextEncoder().encode(" du Parc,-9.50\n"),
    ]);
    const csv = parseCsv(bytes.buffer as ArrayBuffer);
    const normalized = normalizeRows(csv.rows, suggestMapping(csv));

    expect(normalized.ok).toHaveLength(1);
    expect(normalized.ok[0]?.description).toBe("Café du Parc");
  });

  it("handles compact dates and parentheses negatives", () => {
    const { mapping, normalized } = analyze(
      ["Date,Memo,Amount", "20260710,Refund,25.00", "20260711,Store purchase,(42.99)"].join("\n")
    );

    expect(mapping.dateFormat).toBe("compact");
    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok[1]).toMatchObject({ type: "EXPENSE", amount: 42.99 });
  });

  it("parses the bundled dummy-transactions sample", () => {
    const csvText = readFileSync(join(process.cwd(), "sample-data", "dummy-transactions.csv"), "utf8");
    const { csv, mapping, normalized } = analyze(csvText);

    expect(csv.rows.length).toBeGreaterThan(40);
    expect(mapping.date).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.counterparty).toBe(2);
    expect(mapping.amount).toBe(3);
    expect(normalized.ok.length).toBeGreaterThan(40);
    expect(normalized.errors).toHaveLength(0);
  });

  it("preserves expense sign when currency symbol precedes the minus", () => {
    expect(parseLocalizedNumber("€-12,95", "eu")).toBe(-12.95);
    expect(parseLocalizedNumber("$-4.50", "us")).toBe(-4.5);
    expect(parseLocalizedNumber("£-19.99", "us")).toBe(-19.99);
    expect(parseLocalizedNumber("EUR -12,95", "eu")).toBe(-12.95);
    expect(parseLocalizedNumber("-€12,95", "eu")).toBe(-12.95);
    expect(parseLocalizedNumber("-$4.50", "us")).toBe(-4.5);
    expect(parseLocalizedNumber("€12,95−", "eu")).toBe(-12.95); // Unicode minus
    expect(parseLocalizedNumber("(€12,95)", "eu")).toBe(-12.95);
  });

  it("detects Currency column and imports EUR amounts with correct signs", () => {
    const { mapping, normalized, statementCurrency } = analyze(
      [
        "Date,Description,Amount,Currency",
        '2026-07-01,Coffee,"€-4,50",EUR',
        '2026-07-02,Salary,"€2.500,00",EUR',
      ].join("\n")
    );

    expect(mapping.currency).toBe(3);
    expect(mapping.amount).toBe(2);
    expect(statementCurrency).toMatchObject({ code: "EUR", mixed: false, codes: ["EUR"] });
    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok[0]).toMatchObject({ type: "EXPENSE", amount: 4.5 });
    expect(normalized.ok[1]).toMatchObject({ type: "INCOME", amount: 2500 });
  });

  it("skips foreign-currency rows when a Currency column is present", () => {
    const { normalized, statementCurrency } = analyze(
      [
        "Date,Description,Amount,Currency",
        "2026-07-01,Coffee,-4.50,EUR",
        "2026-07-02,Hotel,-120.00,USD",
        "2026-07-03,Salary,2500.00,EUR",
      ].join("\n"),
      "EUR"
    );

    expect(statementCurrency.mixed).toBe(true);
    expect(statementCurrency.codes.sort()).toEqual(["EUR", "USD"]);
    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok.map((row) => row.description)).toEqual(["Coffee", "Salary"]);
    expect(normalized.errors).toHaveLength(1);
    expect(normalized.errors[0]?.message).toContain("Skipped USD");
  });

  it("detects currency from amount symbols when no Currency column exists", () => {
    const { statementCurrency, normalized } = analyze(
      [
        "Date,Description,Amount",
        '2026-07-01,Coffee,"€-12,95"',
        '2026-07-02,Lunch,"€-8,50"',
      ].join("\n")
    );

    expect(statementCurrency.code).toBe("EUR");
    expect(statementCurrency.columnIndex).toBeNull();
    expect(normalized.ok).toHaveLength(2);
    expect(normalized.ok[0]).toMatchObject({ type: "EXPENSE", amount: 12.95 });
  });
});
