import { NextResponse } from "next/server";

import { suggestMatches } from "@/lib/invoices/match";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Suggests bank transactions that likely settle this invoice. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("view_invoices", "view_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { vendor: true, total: true, invoiceDate: true, dueDate: true, direction: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Candidate window: around the invoice/due dates, or recent history when
    // the invoice has no dates.
    const referenceDates = [invoice.invoiceDate, invoice.dueDate].filter(
      (date): date is Date => date !== null
    );
    const earliest =
      referenceDates.length > 0
        ? new Date(Math.min(...referenceDates.map((d) => d.getTime())) - 60 * MS_PER_DAY)
        : new Date(Date.now() - 120 * MS_PER_DAY);
    const latest =
      referenceDates.length > 0
        ? new Date(Math.max(...referenceDates.map((d) => d.getTime())) + 60 * MS_PER_DAY)
        : new Date();

    const candidates = await prisma.transaction.findMany({
      where: {
        workspaceId: workspace.id,
        // A payable is settled by an expense, a receivable by incoming money.
        type: invoice.direction === "RECEIVABLE" ? "INCOME" : "EXPENSE",
        date: { gte: earliest, lte: latest },
        invoice: null, // not already linked to another invoice
      },
      select: { id: true, amount: true, date: true, description: true, counterparty: true },
      take: 2000,
    });

    const suggestions = suggestMatches(
      {
        vendor: invoice.vendor,
        total: Number(invoice.total),
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
      },
      candidates.map((tx) => ({
        id: tx.id,
        amount: Number(tx.amount),
        date: tx.date,
        description: tx.description,
        counterparty: tx.counterparty,
      }))
    );

    const byId = new Map(candidates.map((tx) => [tx.id, tx]));
    return NextResponse.json({
      matches: suggestions.flatMap((suggestion) => {
        const tx = byId.get(suggestion.transactionId);
        if (!tx) return [];
        return [
          {
            ...suggestion,
            transaction: {
              id: tx.id,
              amount: Number(tx.amount),
              date: tx.date.toISOString().slice(0, 10),
              description: tx.description,
              counterparty: tx.counterparty,
            },
          },
        ];
      }),
    });
  } catch (error) {
    return apiError("GET /api/invoices/[id]/matches", "Failed to find matches", error);
  }
}
