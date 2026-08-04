import { describe, expect, it } from "vitest";

import type { ReportData, ReportTransaction } from "@/lib/reports/data";
import { buildMonthlySummaryCsv, buildTransactionsCsv } from "@/lib/reports/export-csv";
import { buildExcelReport } from "@/lib/reports/export-excel";
import { buildPdfReport } from "@/lib/reports/export-pdf";

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
    cashSource: "bank",
    accountsReceivable: 12000,
    accountsPayable: 4300,
    revenueChangePct: 12.5,
    expensesChangePct: -3.1,
    profitChangePct: 48.2,
    marginPrevPct: 25.1,
  },
  monthly: [{ key: "2026-07", label: "Jul 26", revenue: 42000, expenses: 28000.5, profit: 13999.5 }],
  yearly: [
    { year: 2025, revenue: 380000, expenses: 310000, profit: 70000 },
    { year: 2026, revenue: 260000, expenses: 190000, profit: 70000 },
  ],
  incomeCategories: [{ name: "Consulting", color: "#22c55e", total: 42000 }],
  expenseCategories: [
    { name: "Payroll", color: "#ef4444", total: 18000 },
    { name: 'Rent, "HQ"', color: "#f97316", total: 6000 },
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

describe("CSV export", () => {
  it("writes the expected header", () => {
    expect(buildTransactionsCsv(transactions)).toMatch(
      /^Date,Type,Description,Counterparty,Category,Amount/
    );
  });

  it("quotes fields containing commas and escapes embedded quotes", () => {
    const csv = buildTransactionsCsv(transactions);
    expect(csv).toContain('"Invoice 2026-018, Globex"');
    expect(csv).toContain('"Office rent ""HQ"""');
  });

  it("signs expenses negative", () => {
    expect(buildTransactionsCsv(transactions)).toContain("-6000");
  });

  it("includes monthly rows and KPI lines in the summary CSV", () => {
    const csv = buildMonthlySummaryCsv(report);
    expect(csv).toContain("2026-07,42000,28000.5,13999.5");
    expect(csv).toContain("Accounts receivable,12000");
  });
});

describe("Excel export", () => {
  it("produces a real xlsx (zip container) of plausible size", async () => {
    const xlsx = await buildExcelReport(report, transactions);
    expect(xlsx.length).toBeGreaterThan(4000);
    expect(xlsx[0]).toBe(0x50); // "P"
    expect(xlsx[1]).toBe(0x4b); // "K"
  });
});

describe("PDF export", () => {
  it("produces a valid PDF document", async () => {
    const pdf = await buildPdfReport(report);
    expect(Buffer.from(pdf.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
