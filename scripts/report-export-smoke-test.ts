/**
 * Smoke test for the report export generators (PDF / Excel / CSV) and the
 * period resolver. Run with: npx tsx scripts/report-export-smoke-test.ts
 */
import assert from "node:assert/strict";

import type { ReportData, ReportTransaction } from "../src/lib/reports/data";
import { buildMonthlySummaryCsv, buildTransactionsCsv } from "../src/lib/reports/export-csv";
import { buildExcelReport } from "../src/lib/reports/export-excel";
import { buildPdfReport } from "../src/lib/reports/export-pdf";
import { previousPeriod, resolvePeriod } from "../src/lib/reports/period";

const report: ReportData = {
  currency: "EUR",
  generatedAt: "2026-07-27",
  period: { preset: "this-month", label: "Jul 2026", from: "2026-07-01", to: "2026-07-27" },
  kpis: {
    revenue: 42000,
    expenses: 28000.5,
    profit: 13999.5,
    marginPct: 33.3,
    cash: 87500.25,
    accountsReceivable: 12000,
    accountsPayable: 4300,
    revenueChangePct: 12.5,
    expensesChangePct: -3.1,
    profitChangePct: 48.2,
    marginPrevPct: 25.1,
  },
  monthly: [
    { key: "2026-07", label: "Jul 26", revenue: 42000, expenses: 28000.5, profit: 13999.5 },
  ],
  yearly: [
    { year: 2025, revenue: 380000, expenses: 310000, profit: 70000 },
    { year: 2026, revenue: 260000, expenses: 190000, profit: 70000 },
  ],
  incomeCategories: [{ name: "Consulting", color: "#22c55e", total: 42000 }],
  expenseCategories: [
    { name: "Payroll", color: "#ef4444", total: 18000 },
    { name: "Rent, \"HQ\"", color: "#f97316", total: 6000 },
  ],
  topVendors: [{ name: "Acme Landlord B.V.", total: 6000, count: 1 }],
  topCustomers: [{ name: "Globex Corp", total: 30000, count: 3 }],
  arAging: [
    { label: "Current", count: 1, total: 8000 },
    { label: "1–30 days", count: 1, total: 4000 },
    { label: "31–60 days", count: 0, total: 0 },
    { label: "60+ days", count: 0, total: 0 },
  ],
  apAging: [
    { label: "Current", count: 2, total: 4300 },
    { label: "1–30 days", count: 0, total: 0 },
    { label: "31–60 days", count: 0, total: 0 },
    { label: "60+ days", count: 0, total: 0 },
  ],
};

const transactions: ReportTransaction[] = [
  {
    date: "2026-07-03",
    type: "INCOME",
    description: "Invoice 2026-018, Globex",
    counterparty: "Globex Corp",
    category: "Consulting",
    amount: 10000,
  },
  {
    date: "2026-07-05",
    type: "EXPENSE",
    description: 'Office rent "HQ"',
    counterparty: "Acme Landlord B.V.",
    category: "Rent",
    amount: 6000,
  },
];

async function main() {
  /* Period resolver */
  const now = new Date("2026-07-27T10:00:00Z");
  const thisMonth = resolvePeriod("this-month", undefined, undefined, now);
  assert.equal(thisMonth.from.toISOString().slice(0, 10), "2026-07-01");
  const prev = previousPeriod(thisMonth);
  assert.equal(prev.from.toISOString().slice(0, 10), "2026-06-01");
  assert.equal(prev.to.toISOString().slice(0, 10), "2026-06-30");
  const quarter = resolvePeriod("quarter", undefined, undefined, now);
  assert.equal(quarter.label, "Q3 2026");
  const custom = resolvePeriod("custom", "2026-01-15", "2026-02-14", now);
  assert.equal(custom.preset, "custom");
  const invalidCustom = resolvePeriod("custom", "2026-05-01", "2026-01-01", now);
  assert.equal(invalidCustom.preset, "this-month"); // inverted range falls back
  console.log("period resolver ok");

  /* CSV */
  const txCsv = buildTransactionsCsv(transactions);
  assert.ok(txCsv.startsWith("Date,Type,Description,Counterparty,Category,Amount"));
  assert.ok(txCsv.includes('"Invoice 2026-018, Globex"')); // comma quoted
  assert.ok(txCsv.includes("-6000")); // expenses negative
  const summaryCsv = buildMonthlySummaryCsv(report);
  assert.ok(summaryCsv.includes("2026-07,42000,28000.5,13999.5"));
  assert.ok(summaryCsv.includes("Accounts receivable,12000"));
  console.log("csv ok");

  /* Excel */
  const xlsx = await buildExcelReport(report, transactions);
  assert.ok(xlsx.length > 4000, `xlsx too small: ${xlsx.length}`);
  assert.equal(xlsx[0], 0x50); // "PK" zip magic
  assert.equal(xlsx[1], 0x4b);
  console.log(`excel ok (${xlsx.length} bytes)`);

  /* PDF */
  const pdf = await buildPdfReport(report);
  const head = Buffer.from(pdf.slice(0, 5)).toString("ascii");
  assert.equal(head, "%PDF-");
  assert.ok(pdf.length > 2000, `pdf too small: ${pdf.length}`);
  console.log(`pdf ok (${pdf.length} bytes)`);

  console.log("report export smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
