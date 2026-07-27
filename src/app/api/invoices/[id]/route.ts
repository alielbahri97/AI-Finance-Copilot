import { NextResponse } from "next/server";

import { deleteInvoiceDocument } from "@/lib/invoices/storage";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { createClient, getUser } from "@/lib/supabase/server";
import { invoiceUpdateSchema } from "@/lib/validations/invoice";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId: user.id },
      include: { lineItems: true, transaction: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  } catch (error) {
    console.error("GET /api/invoices/[id] failed:", error);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const existing = await prisma.invoice.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = invoiceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid invoice data", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { lineItems, ...fields } = parsed.data;

    const invoice = await prisma.$transaction(async (tx) => {
      if (lineItems) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        if (lineItems.length > 0) {
          await tx.invoiceLineItem.createMany({
            data: lineItems.map((item, index) => ({
              invoiceId: id,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
              sortOrder: index,
            })),
          });
        }
      }
      return tx.invoice.update({
        where: { id },
        data: fields,
        include: { lineItems: true, transaction: true },
      });
    });

    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  } catch (error) {
    console.error("PATCH /api/invoices/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId: user.id },
      select: { id: true, storagePath: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const supabase = await createClient();
    await deleteInvoiceDocument(supabase, invoice.storagePath);
    await prisma.invoice.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/invoices/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
