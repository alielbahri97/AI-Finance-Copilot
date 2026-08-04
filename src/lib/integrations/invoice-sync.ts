import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Shared upsert for invoices pulled from accounting systems (QuickBooks,
 * Xero, Exact Online). Rows are deduped on externalRef; re-syncs update
 * totals/status instead of duplicating. Synced invoices have no stored
 * document (storagePath is empty) and are marked EXTRACTED because the data
 * comes straight from the source system.
 */

export interface SyncedInvoice {
  /** Stable id, e.g. "xero:9f2b...". */
  externalRef: string;
  vendor: string;
  invoiceNumber: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  direction: "PAYABLE" | "RECEIVABLE";
  status: "PAID" | "UNPAID";
}

function toDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export async function upsertSyncedInvoices(
  scope: { workspaceId: string; userId: string },
  invoices: SyncedInvoice[]
): Promise<{ created: number; updated: number }> {
  const { workspaceId, userId } = scope;
  if (invoices.length === 0) return { created: 0, updated: 0 };

  const existing = await prisma.invoice.findMany({
    where: { workspaceId, externalRef: { in: invoices.map((invoice) => invoice.externalRef) } },
    select: { id: true, externalRef: true, status: true },
  });
  const byRef = new Map(existing.map((row) => [row.externalRef, row]));

  let created = 0;
  let updated = 0;

  for (const invoice of invoices) {
    const current = byRef.get(invoice.externalRef);
    const common = {
      vendor: invoice.vendor.slice(0, 300),
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: toDate(invoice.invoiceDate),
      dueDate: toDate(invoice.dueDate),
      currency: invoice.currency,
      total: Math.round(invoice.total * 100) / 100,
      direction: invoice.direction,
    };

    if (current) {
      await prisma.invoice.update({
        where: { id: current.id },
        data: {
          ...common,
          // Don't overwrite a manual "paid" mark with UNPAID from the source.
          ...(current.status !== "PAID" || invoice.status === "PAID"
            ? { status: invoice.status }
            : {}),
        },
      });
      updated += 1;
    } else {
      await prisma.invoice.create({
        data: {
          workspaceId,
          userId,
          ...common,
          status: invoice.status,
          extractionStatus: "EXTRACTED",
          storagePath: "",
          fileName: "",
          mimeType: "",
          externalRef: invoice.externalRef,
        },
      });
      created += 1;
    }
  }

  return { created, updated };
}
