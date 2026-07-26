/**
 * Smoke test for the CSV import pipeline. Run with:
 *   npx tsx scripts/csv-smoke-test.ts
 */
import { suggestMapping } from "../src/lib/csv/detect";
import { normalizeRows } from "../src/lib/csv/normalize";
import { parseCsv } from "../src/lib/csv/parse";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

function run(name: string, csvText: string, assertions: (result: ReturnType<typeof analyze>) => void) {
  console.log(`\n${name}`);
  assertions(analyze(csvText));
}

function analyze(csvText: string) {
  const buffer = new TextEncoder().encode(csvText).buffer as ArrayBuffer;
  const csv = parseCsv(buffer);
  const mapping = suggestMapping(csv);
  const normalized = normalizeRows(csv.rows, mapping);
  return { csv, mapping, normalized };
}

/* US bank export: comma delimited, mm/dd/yyyy, signed amounts, quoted fields */
run(
  "US format (comma, mdy, signed amount)",
  [
    "Date,Description,Amount,Balance",
    '07/15/2026,"STARBUCKS #123, SEATTLE",-4.50,"1,234.56"',
    "07/16/2026,PAYCHECK ACME INC,2500.00,3734.56",
  ].join("\r\n"),
  ({ csv, mapping, normalized }) => {
    check("delimiter is comma", csv.delimiter === ",");
    check("header detected", csv.headers?.[0] === "Date");
    check("date column mapped", mapping.date === 0);
    check("amount column mapped", mapping.amount === 2);
    check("balance column mapped", mapping.balance === 3);
    check("mdy detected", mapping.dateFormat === "mdy", mapping.dateFormat);
    check("us numbers detected", mapping.numberFormat === "us");
    check("2 rows normalized", normalized.ok.length === 2, normalized.errors);
    check("expense sign", normalized.ok[0]?.type === "EXPENSE" && normalized.ok[0]?.amount === 4.5);
    check("quoted comma kept", normalized.ok[0]?.description.includes("SEATTLE"));
    check("income parsed", normalized.ok[1]?.type === "INCOME" && normalized.ok[1]?.amount === 2500);
    check("date iso", normalized.ok[0]?.date === "2026-07-15", normalized.ok[0]?.date);
    check("balance parsed", normalized.ok[0]?.balance === 1234.56, normalized.ok[0]?.balance);
  }
);

/* Dutch bank export: semicolon, dd-mm-yyyy, EU numbers, debit/credit pair */
run(
  "EU format (semicolon, dmy, debit/credit)",
  [
    "Boekdatum;Omschrijving;Naam tegenpartij;Af;Bij;Saldo",
    "15-07-2026;Albert Heijn 1584;AH BV;12,95;;1.500,00",
    "16-07-2026;Salaris juli;Optiver;;3.250,50;4.750,50",
  ].join("\n"),
  ({ csv, mapping, normalized }) => {
    check("delimiter is semicolon", csv.delimiter === ";");
    check("debit mapped", mapping.debit === 3, mapping);
    check("credit mapped", mapping.credit === 4, mapping);
    check("counterparty mapped", mapping.counterparty === 2, mapping);
    check("eu numbers detected", mapping.numberFormat === "eu");
    check("dmy detected", mapping.dateFormat === "dmy");
    check("2 rows normalized", normalized.ok.length === 2, normalized.errors);
    check("debit row is expense", normalized.ok[0]?.type === "EXPENSE" && normalized.ok[0]?.amount === 12.95);
    check(
      "credit row is income with thousands",
      normalized.ok[1]?.type === "INCOME" && normalized.ok[1]?.amount === 3250.5,
      normalized.ok[1]
    );
    check("eu balance parsed", normalized.ok[0]?.balance === 1500, normalized.ok[0]?.balance);
  }
);

/* Tab separated, ISO dates, no header */
run(
  "TSV without header (ymd)",
  ["2026-07-01\tCoffee shop\t-3.20", "2026-07-02\tBook store\t-15.00"].join("\n"),
  ({ csv, mapping, normalized }) => {
    check("delimiter is tab", csv.delimiter === "\t");
    check("no header", csv.headers === null);
    check("ymd detected", mapping.dateFormat === "ymd");
    check("2 rows normalized", normalized.ok.length === 2, { mapping, errors: normalized.errors });
  }
);

/* Windows-1252 encoded file with accented characters */
run("Windows-1252 encoding", "", () => {
  const bytes = new Uint8Array([
    ...new TextEncoder().encode("Date,Description,Amount\n2026-07-01,Caf"),
    0xe9, // é in windows-1252
    ...new TextEncoder().encode(" du Parc,-9.50\n"),
  ]);
  const csv = parseCsv(bytes.buffer as ArrayBuffer);
  const mapping = suggestMapping(csv);
  const normalized = normalizeRows(csv.rows, mapping);
  check("row parsed", normalized.ok.length === 1, normalized.errors);
  check("accent decoded", normalized.ok[0]?.description === "Café du Parc", normalized.ok[0]?.description);
});

/* Parentheses negatives and compact dates */
run(
  "Compact dates + parentheses negatives",
  ["Date,Memo,Amount", "20260710,Refund,25.00", "20260711,Store purchase,(42.99)"].join("\n"),
  ({ mapping, normalized }) => {
    check("compact detected", mapping.dateFormat === "compact", mapping.dateFormat);
    check("2 rows", normalized.ok.length === 2, normalized.errors);
    check("parentheses negative", normalized.ok[1]?.type === "EXPENSE" && normalized.ok[1]?.amount === 42.99);
  }
);

console.log(failures === 0 ? "\nAll CSV smoke tests passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
