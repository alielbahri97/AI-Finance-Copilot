import ExcelJS from "exceljs";

import type { Prisma } from "@/generated/prisma/client";
import { BRAND } from "@/lib/branding";
import { prisma } from "@/lib/prisma";

import { csvLines } from "./csv";

const MAX_ROWS = 20_000;

export interface TransactionExportFilters {
  q?: string;
  type?: string;
  category?: string;
  batch?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amount = Number(value);
  return Number.isNaN(amount) || amount < 0 ? undefined : amount;
}

/** Same filter semantics as the transactions page list. */
export function buildTransactionExportWhere(
  workspaceId: string,
  filters: TransactionExportFilters
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { workspaceId };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { counterparty: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filters.type === "INCOME" || filters.type === "EXPENSE") where.type = filters.type;
  if (filters.category === "uncategorized") where.categoryId = null;
  else if (filters.category) where.categoryId = filters.category;
  if (filters.batch) where.importBatchId = filters.batch;
  const from = parseDate(filters.from);
  const to = parseDate(filters.to, true);
  if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
  const min = parseAmount(filters.min);
  const max = parseAmount(filters.max);
  if (min !== undefined || max !== undefined) {
    where.amount = { ...(min !== undefined && { gte: min }), ...(max !== undefined && { lte: max }) };
  }
  return where;
}

export async function loadExportTransactions(
  workspaceId: string,
  filters: TransactionExportFilters
) {
  return prisma.transaction.findMany({
    where: buildTransactionExportWhere(workspaceId, filters),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: MAX_ROWS,
    include: { category: { select: { name: true } } },
  });
}

export function buildFilteredTransactionsCsv(
  rows: Awaited<ReturnType<typeof loadExportTransactions>>
): string {
  return csvLines([
    ["Date", "Type", "Description", "Counterparty", "Category", "Amount"],
    ...rows.map((tx) => [
      tx.date.toISOString().slice(0, 10),
      tx.type,
      tx.description,
      tx.counterparty,
      tx.category?.name ?? "",
      tx.type === "EXPENSE" ? -Number(tx.amount) : Number(tx.amount),
    ]),
  ]);
}

export async function buildFilteredTransactionsExcel(
  rows: Awaited<ReturnType<typeof loadExportTransactions>>,
  currency: string
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.name;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Transactions");
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 10 },
    { header: "Description", key: "description", width: 44 },
    { header: "Counterparty", key: "counterparty", width: 28 },
    { header: "Category", key: "category", width: 20 },
    { header: "Amount", key: "amount", width: 14 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  for (const tx of rows) {
    sheet.addRow({
      date: tx.date.toISOString().slice(0, 10),
      type: tx.type,
      description: tx.description,
      counterparty: tx.counterparty,
      category: tx.category?.name ?? "",
      amount: tx.type === "EXPENSE" ? -Number(tx.amount) : Number(tx.amount),
    });
  }
  sheet.getColumn("amount").numFmt = `#,##0.00 "${currency}"`;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
