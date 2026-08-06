import { describe, expect, it } from "vitest";

import { csvCell, csvLines, withBom } from "@/lib/exports/csv";
import { buildForecastCsv } from "@/lib/exports/forecast";
import type { ForecastResult } from "@/lib/finance/forecast";
import { buildInvoicesCsv } from "@/lib/exports/invoices";

describe("shared CSV helpers", () => {
  it("quotes commas and escapes embedded quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it("joins rows with CRLF", () => {
    expect(csvLines([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });

  it("prefixes a UTF-8 BOM", () => {
    expect(withBom("x")).toBe("\uFEFFx");
  });
});

describe("invoice export CSV", () => {
  const base = {
    id: "1",
    workspaceId: "w",
    userId: "u",
    vendor: "Acme",
    invoiceNumber: "INV-1",
    invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
    dueDate: new Date("2026-08-15T00:00:00.000Z"),
    currency: "EUR",
    subtotal: 100 as unknown as never,
    vatAmount: 21 as unknown as never,
    vatRate: null,
    total: 121 as unknown as never,
    direction: "PAYABLE" as const,
    status: "UNPAID" as const,
    extractionStatus: "EXTRACTED" as const,
    extractionProvider: null,
    extractionModel: null,
    extractionDurationMs: null,
    extractionReason: null,
    extractionWarnings: null,
    extractionConfidence: null,
    storagePath: "x",
    fileName: "x.pdf",
    mimeType: "application/pdf",
    notes: null,
    transactionId: null,
    externalRef: null,
    customerEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("writes header-only rows without line items", () => {
    const csv = buildInvoicesCsv(
      [base] as unknown as Parameters<typeof buildInvoicesCsv>[0],
      false
    );
    expect(csv).toMatch(/^Invoice number,Vendor,Status/);
    expect(csv).toContain("INV-1,Acme,UNPAID");
  });

  it("flattens line items when requested", () => {
    const csv = buildInvoicesCsv(
      [
        {
          ...base,
          lineItems: [
            {
              id: "l1",
              invoiceId: "1",
              description: "Consulting",
              quantity: 2 as unknown as never,
              unitPrice: 50 as unknown as never,
              total: 100 as unknown as never,
              sortOrder: 0,
            },
          ],
        },
      ] as unknown as Parameters<typeof buildInvoicesCsv>[0],
      true
    );
    expect(csv).toContain("Line description");
    expect(csv).toContain("Consulting");
  });
});

describe("forecast export CSV", () => {
  const forecast: ForecastResult = {
    currency: "EUR",
    generatedAt: "2026-08-05",
    currentBalance: 1000,
    metrics: {
      runwayMonths: 6,
      netBurnRate: 200,
      grossBurnRate: 500,
      avgMonthlyIncome: 300,
      avgMonthlyExpenses: 500,
      recurringMonthlyIncome: 300,
      recurringMonthlyExpenses: 400,
      projectedBalance30d: 900,
      projectedBalance90d: 700,
      projectedBalance12m: 100,
    },
    horizons: {
      d30: [],
      d90: [],
      m12: [
        { date: "2026-08-05", actual: 1000, projected: null, band: null },
        { date: "2026-09-05", actual: null, projected: 900, band: [800, 1000] },
      ],
    },
    recurringIncome: [],
    recurringExpenses: [],
    upcomingBills: [
      {
        label: "Rent",
        category: "Housing",
        amount: 1200,
        dueDate: "2026-09-01",
        cadence: "monthly",
        source: "detected",
      },
    ],
    activeAssumptions: 0,
  };

  it("includes metrics and projection rows", () => {
    const csv = buildForecastCsv(forecast);
    expect(csv).toContain("Current balance,1000");
    expect(csv).toContain("2026-09-05");
    expect(csv).toContain("Rent");
  });
});
