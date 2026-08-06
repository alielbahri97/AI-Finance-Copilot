import ExcelJS from "exceljs";

import type { Prisma } from "@/generated/prisma/client";
import { BRAND } from "@/lib/branding";
import { prisma } from "@/lib/prisma";

import { csvLines } from "./csv";

const MAX_INVOICES = 5_000;

export interface InvoiceExportFilters {
  status?: string;
  vendor?: string;
  from?: string;
  to?: string;
  includeLines?: boolean;
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildInvoiceExportWhere(
  workspaceId: string,
  filters: InvoiceExportFilters
): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { workspaceId };
  if (filters.status === "OVERDUE") {
    where.status = "UNPAID";
    where.dueDate = { lt: new Date() };
  } else if (filters.status && ["DRAFT", "UNPAID", "PAID"].includes(filters.status)) {
    where.status = filters.status as "DRAFT" | "UNPAID" | "PAID";
  }
  if (filters.vendor) {
    where.vendor = { contains: filters.vendor, mode: "insensitive" };
  }
  const from = parseDate(filters.from);
  const to = parseDate(filters.to, true);
  if (from || to) {
    where.invoiceDate = { ...(from && { gte: from }), ...(to && { lte: to }) };
  }
  return where;
}

export async function loadExportInvoices(workspaceId: string, filters: InvoiceExportFilters) {
  return prisma.invoice.findMany({
    where: buildInvoiceExportWhere(workspaceId, filters),
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: MAX_INVOICES,
    include: filters.includeLines ? { lineItems: true } : undefined,
  });
}

type InvoiceRow = Awaited<ReturnType<typeof loadExportInvoices>>[number];

export function buildInvoicesCsv(rows: InvoiceRow[], includeLines: boolean): string {
  if (!includeLines) {
    return csvLines([
      [
        "Invoice number",
        "Vendor",
        "Status",
        "Direction",
        "Invoice date",
        "Due date",
        "Currency",
        "Subtotal",
        "VAT",
        "Total",
      ],
      ...rows.map((inv) => [
        inv.invoiceNumber,
        inv.vendor,
        inv.status,
        inv.direction,
        inv.invoiceDate?.toISOString().slice(0, 10) ?? "",
        inv.dueDate?.toISOString().slice(0, 10) ?? "",
        inv.currency,
        inv.subtotal === null ? "" : Number(inv.subtotal),
        inv.vatAmount === null ? "" : Number(inv.vatAmount),
        inv.total === null ? "" : Number(inv.total),
      ]),
    ]);
  }

  const header = [
    "Invoice number",
    "Vendor",
    "Status",
    "Direction",
    "Invoice date",
    "Due date",
    "Currency",
    "Subtotal",
    "VAT",
    "Total",
    "Line description",
    "Line qty",
    "Line unit price",
    "Line total",
  ];
  const data: (string | number | null)[][] = [header];
  for (const inv of rows) {
    const lines = "lineItems" in inv && Array.isArray(inv.lineItems) ? inv.lineItems : [];
    if (lines.length === 0) {
      data.push([
        inv.invoiceNumber,
        inv.vendor,
        inv.status,
        inv.direction,
        inv.invoiceDate?.toISOString().slice(0, 10) ?? "",
        inv.dueDate?.toISOString().slice(0, 10) ?? "",
        inv.currency,
        inv.subtotal === null ? "" : Number(inv.subtotal),
        inv.vatAmount === null ? "" : Number(inv.vatAmount),
        inv.total === null ? "" : Number(inv.total),
        "",
        "",
        "",
        "",
      ]);
      continue;
    }
    for (const line of lines) {
      data.push([
        inv.invoiceNumber,
        inv.vendor,
        inv.status,
        inv.direction,
        inv.invoiceDate?.toISOString().slice(0, 10) ?? "",
        inv.dueDate?.toISOString().slice(0, 10) ?? "",
        inv.currency,
        inv.subtotal === null ? "" : Number(inv.subtotal),
        inv.vatAmount === null ? "" : Number(inv.vatAmount),
        inv.total === null ? "" : Number(inv.total),
        line.description,
        line.quantity === null ? "" : Number(line.quantity),
        line.unitPrice === null ? "" : Number(line.unitPrice),
        line.total === null ? "" : Number(line.total),
      ]);
    }
  }
  return csvLines(data);
}

export async function buildInvoicesExcel(
  rows: InvoiceRow[],
  currency: string,
  includeLines: boolean
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.name;
  const sheet = workbook.addWorksheet("Invoices");
  if (!includeLines) {
    sheet.columns = [
      { header: "Invoice number", key: "invoiceNumber", width: 16 },
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "Status", key: "status", width: 10 },
      { header: "Direction", key: "direction", width: 12 },
      { header: "Invoice date", key: "invoiceDate", width: 12 },
      { header: "Due date", key: "dueDate", width: 12 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Subtotal", key: "subtotal", width: 12 },
      { header: "VAT", key: "vat", width: 12 },
      { header: "Total", key: "total", width: 12 },
    ];
    for (const inv of rows) {
      sheet.addRow({
        invoiceNumber: inv.invoiceNumber,
        vendor: inv.vendor,
        status: inv.status,
        direction: inv.direction,
        invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? "",
        dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? "",
        currency: inv.currency,
        subtotal: inv.subtotal === null ? null : Number(inv.subtotal),
        vat: inv.vatAmount === null ? null : Number(inv.vatAmount),
        total: inv.total === null ? null : Number(inv.total),
      });
    }
  } else {
    sheet.columns = [
      { header: "Invoice number", key: "invoiceNumber", width: 16 },
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "Status", key: "status", width: 10 },
      { header: "Line description", key: "lineDescription", width: 36 },
      { header: "Line qty", key: "qty", width: 10 },
      { header: "Line unit price", key: "unitPrice", width: 14 },
      { header: "Line total", key: "lineTotal", width: 12 },
      { header: "Invoice total", key: "total", width: 12 },
    ];
    for (const inv of rows) {
      const lines = "lineItems" in inv && Array.isArray(inv.lineItems) ? inv.lineItems : [];
      if (lines.length === 0) {
        sheet.addRow({
          invoiceNumber: inv.invoiceNumber,
          vendor: inv.vendor,
          status: inv.status,
          lineDescription: "",
          qty: null,
          unitPrice: null,
          lineTotal: null,
          total: inv.total === null ? null : Number(inv.total),
        });
        continue;
      }
      for (const line of lines) {
        sheet.addRow({
          invoiceNumber: inv.invoiceNumber,
          vendor: inv.vendor,
          status: inv.status,
          lineDescription: line.description,
          qty: line.quantity === null ? null : Number(line.quantity),
          unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
          lineTotal: line.total === null ? null : Number(line.total),
          total: inv.total === null ? null : Number(inv.total),
        });
      }
    }
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  for (const key of ["subtotal", "vat", "total", "unitPrice", "lineTotal"]) {
    try {
      sheet.getColumn(key).numFmt = `#,##0.00 "${currency}"`;
    } catch {
      // column may not exist in the no-lines layout
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
