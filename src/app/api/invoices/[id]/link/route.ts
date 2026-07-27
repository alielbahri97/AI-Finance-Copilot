import { NextResponse } from "next/server";

import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { invoiceLinkSchema } from "@/lib/validations/invoice";
import { apiError } from "@/lib/api/response";

type RouteContext = { params: Promise<{ id: string }> };

/** Links a transaction to the invoice and marks it paid. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const parsed = invoiceLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link request" }, { status: 400 });
    }

    const [invoice, transaction] = await Promise.all([
      prisma.invoice.findFirst({ where: { id, userId: user.id }, select: { id: true } }),
      prisma.transaction.findFirst({
        where: { id: parsed.data.transactionId, userId: user.id },
        select: { id: true, invoice: { select: { id: true } } },
      }),
    ]);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (transaction.invoice && transaction.invoice.id !== id) {
      return NextResponse.json(
        { error: "That transaction is already linked to another invoice" },
        { status: 409 }
      );
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { transactionId: transaction.id, status: "PAID" },
      include: { lineItems: true, transaction: true },
    });

    return NextResponse.json({ invoice: serializeInvoice(updated) });
  } catch (error) {
    return apiError("POST /api/invoices/[id]/link", "Failed to link transaction", error);
  }
}

/** Removes the transaction link; the invoice reverts to unpaid. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { transactionId: null, status: "UNPAID" },
      include: { lineItems: true, transaction: true },
    });

    return NextResponse.json({ invoice: serializeInvoice(updated) });
  } catch (error) {
    return apiError("DELETE /api/invoices/[id]/link", "Failed to unlink transaction", error);
  }
}
