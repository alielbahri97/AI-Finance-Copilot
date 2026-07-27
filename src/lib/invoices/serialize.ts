import type { Invoice, InvoiceLineItem, Transaction } from "@/generated/prisma/client";

/**
 * Plain-JSON invoice shapes shared by the API routes and server pages.
 * `derivedStatus` adds OVERDUE, computed from due date + unpaid status.
 */

export type DerivedInvoiceStatus = "DRAFT" | "UNPAID" | "PAID" | "OVERDUE";

export interface InvoiceLineItemDto {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceTransactionDto {
  id: string;
  description: string;
  counterparty: string | null;
  date: string;
  amount: number;
}

export interface InvoiceDto {
  id: string;
  vendor: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotal: number | null;
  vatAmount: number | null;
  vatRate: number | null;
  total: number;
  status: "DRAFT" | "UNPAID" | "PAID";
  derivedStatus: DerivedInvoiceStatus;
  extractionStatus: "EXTRACTED" | "NEEDS_REVIEW" | "MANUAL";
  fileName: string;
  mimeType: string;
  notes: string | null;
  createdAt: string;
  lineItems: InvoiceLineItemDto[];
  transaction: InvoiceTransactionDto | null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function deriveStatus(
  status: "DRAFT" | "UNPAID" | "PAID",
  dueDate: Date | null,
  now = new Date()
): DerivedInvoiceStatus {
  if (status === "UNPAID" && dueDate && dueDate.getTime() < now.setHours(0, 0, 0, 0)) {
    return "OVERDUE";
  }
  return status;
}

export function serializeInvoice(
  invoice: Invoice & { lineItems?: InvoiceLineItem[]; transaction?: Transaction | null }
): InvoiceDto {
  return {
    id: invoice.id,
    vendor: invoice.vendor,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate ? isoDay(invoice.invoiceDate) : null,
    dueDate: invoice.dueDate ? isoDay(invoice.dueDate) : null,
    currency: invoice.currency,
    subtotal: invoice.subtotal === null ? null : Number(invoice.subtotal),
    vatAmount: invoice.vatAmount === null ? null : Number(invoice.vatAmount),
    vatRate: invoice.vatRate === null ? null : Number(invoice.vatRate),
    total: Number(invoice.total),
    status: invoice.status,
    derivedStatus: deriveStatus(invoice.status, invoice.dueDate),
    extractionStatus: invoice.extractionStatus,
    fileName: invoice.fileName,
    mimeType: invoice.mimeType,
    notes: invoice.notes,
    createdAt: invoice.createdAt.toISOString(),
    lineItems: (invoice.lineItems ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
      })),
    transaction: invoice.transaction
      ? {
          id: invoice.transaction.id,
          description: invoice.transaction.description,
          counterparty: invoice.transaction.counterparty,
          date: isoDay(invoice.transaction.date),
          amount: Number(invoice.transaction.amount),
        }
      : null,
  };
}
