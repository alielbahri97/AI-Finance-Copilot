import { describe, expect, it } from "vitest";

import { suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import {
  parseMt940,
  parseMt940Amount,
  parseStatementInformation,
  parseStatementLine,
} from "@/lib/import/mt940";
import { StatementParseError } from "@/lib/import/types";

/** Two statements in one file, as a bank's "download all" export delivers. */
const TWO_STATEMENTS = [
  ":20:STARTUMS",
  ":25:NL91ABNA0417164300",
  ":28C:00001/001",
  ":60F:C240101EUR1500,00",
  ":61:2401020102D12,95NTRFNONREF//BANK123",
  ":86:/TRTP/SEPA OVERBOEKING/IBAN/NL02ABNA0123456789/BIC/ABNANL2A/NAME/ALBERT HE",
  "IJN 1584/REMI/Boodschappen 2 januari",
  ":61:2401050105C3250,50NTRFSALARIS",
  ":86:/TRTP/SEPA OVERBOEKING/IBAN/NL55INGB0000000000/NAME/OPTIVER V.O.F./REMI/Sal",
  "aris januari",
  ":62F:C240131EUR4737,55",
  ":20:STARTUMS2",
  ":25:NL91ABNA0417164300",
  ":28C:00002/001",
  ":60F:C240201EUR4737,55",
  ":61:2402030203RD100,00NTRFREVERSAL",
  ":86:Reversal of an erroneous",
  "card payment",
  ":62F:C240229EUR4837,55",
].join("\r\n");

function analyze(text: string) {
  const statement = parseMt940(text);
  const mapping = suggestMapping(statement);
  return { statement, mapping, normalized: normalizeRows(statement.rows, mapping) };
}

describe("MT940 parsing", () => {
  it("derives signs from the debit/credit mark and parses comma decimals", () => {
    const { statement, normalized } = analyze(TWO_STATEMENTS);

    expect(statement.format).toBe("mt940");
    expect(statement.source).toBe("MT940 statement in EUR");
    expect(statement.rows).toHaveLength(3);

    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ok[0]).toMatchObject({
      date: "2024-01-02",
      type: "EXPENSE",
      amount: 12.95,
      counterparty: "ALBERT HEIJN 1584",
    });
    expect(normalized.ok[1]).toMatchObject({
      date: "2024-01-05",
      type: "INCOME",
      amount: 3250.5,
    });
    // RD reverses a debit, so it credits the account.
    expect(normalized.ok[2]).toMatchObject({ date: "2024-02-03", type: "INCOME", amount: 100 });
  });

  it("joins wrapped :86: continuation lines", () => {
    const { normalized } = analyze(TWO_STATEMENTS);

    expect(normalized.ok[0]?.description).toBe("Boodschappen 2 januari");
    expect(normalized.ok[1]?.description).toBe("Salaris januari");
    expect(normalized.ok[2]?.description).toBe("Reversal of an erroneous card payment");
  });

  it("keeps a running balance per statement and picks up the currency", () => {
    const { statement, mapping, normalized } = analyze(TWO_STATEMENTS);

    expect(statement.headers).toContain("Balance");
    expect(mapping.currency).not.toBeNull();
    expect(normalized.ok.map((row) => row.balance)).toEqual([1487.05, 4737.55, 4837.55]);
  });

  it("carries the entry date across a new-year boundary", () => {
    const line = parseStatementLine("2401021230D25,00NTRFNONREF");
    expect(line).toMatchObject({ valueDate: "2024-01-02", entryDate: "2023-12-30" });
  });

  it("reads German ?NN? structured information", () => {
    const information = parseStatementInformation(
      "166?00DAUERAUFTRAG?20SVWZ+Miete Januar?21 2024?32MUSTERMANN?33 GMBH"
    );
    expect(information).toEqual({
      description: "SVWZ+Miete Januar 2024",
      counterparty: "MUSTERMANN GMBH",
    });
  });

  it("falls back to the :61: reference when no :86: follows", () => {
    const { normalized } = analyze(
      [
        ":20:REF",
        ":60F:C240101EUR0,00",
        ":61:240102D9,99NTRFCARD PAYMENT 4321",
        ":62F:D240102EUR9,99",
      ].join("\n")
    );
    expect(normalized.ok[0]).toMatchObject({
      description: "CARD PAYMENT 4321",
      type: "EXPENSE",
      amount: 9.99,
    });
  });

  it("strips the SWIFT envelope", () => {
    const { statement } = analyze(
      [
        "{1:F01ABNANL2AXXXX0000000000}{2:O9401200240102ABNANL2AXXXX00000000002401021200N}{4:",
        ":20:940A",
        ":25:NL91ABNA0417164300",
        ":60F:C240101EUR100,00",
        ":61:240102C50,00NTRFDEPOSIT",
        ":62F:C240102EUR150,00",
        "-}",
      ].join("\r\n")
    );
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0][4]).toBe("50.00");
  });

  it("parses amounts with and without decimals", () => {
    expect(parseMt940Amount("1234,56")).toBe(1234.56);
    expect(parseMt940Amount("100,")).toBe(100);
    expect(parseMt940Amount("0,05")).toBe(0.05);
    expect(parseMt940Amount("1.234,56")).toBeNull();
  });

  it("rejects a file without :61: lines", () => {
    expect(() =>
      parseMt940([":20:REF", ":25:NL91ABNA0417164300", ":62F:C240102EUR0,00"].join("\n"))
    ).toThrowError(StatementParseError);
  });

  it("rejects a file with no MT940 tags at all", () => {
    expect(() => parseMt940("Date,Description,Amount\n2024-01-02,Coffee,-4.50")).toThrowError(
      /no MT940 tags/i
    );
  });
});
