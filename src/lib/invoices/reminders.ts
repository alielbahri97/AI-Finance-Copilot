import "server-only";

import { prisma } from "@/lib/prisma";

import { serializeInvoice, type InvoiceDto } from "./serialize";

export interface InvoiceReminders {
  /** Unpaid invoices whose due date has passed. */
  overdue: InvoiceDto[];
  /** Unpaid invoices due within the next 7 days. */
  dueSoon: InvoiceDto[];
  overdueTotal: number;
  dueSoonTotal: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Due-soon and overdue unpaid invoices. Shared by the reminders API, the
 * invoices page and the main dashboard card (and, later, notifications).
 */
export async function getInvoiceReminders(workspaceId: string): Promise<InvoiceReminders> {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * MS_PER_DAY);

  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId,
      status: "UNPAID",
      dueDate: { not: null, lte: weekAhead },
    },
    orderBy: { dueDate: "asc" },
    include: { lineItems: true, transaction: true },
    take: 100,
  });

  const overdue: InvoiceDto[] = [];
  const dueSoon: InvoiceDto[] = [];
  for (const invoice of invoices) {
    const dto = serializeInvoice(invoice);
    if (dto.derivedStatus === "OVERDUE") overdue.push(dto);
    else dueSoon.push(dto);
  }

  return {
    overdue,
    dueSoon,
    overdueTotal: Math.round(overdue.reduce((sum, invoice) => sum + invoice.total, 0) * 100) / 100,
    dueSoonTotal: Math.round(dueSoon.reduce((sum, invoice) => sum + invoice.total, 0) * 100) / 100,
  };
}
