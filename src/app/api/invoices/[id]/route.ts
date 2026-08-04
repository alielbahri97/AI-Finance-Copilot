import { NextResponse } from "next/server";

import { deleteInvoiceDocument } from "@/lib/invoices/storage";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { invoiceUpdateSchema } from "@/lib/validations/invoice";
import { apiError } from "@/lib/api/response";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("view_invoices");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
      include: { lineItems: true, transaction: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  } catch (error) {
    return apiError("GET /api/invoices/[id]", "Failed to load invoice", error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("edit_invoices");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const existing = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
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
    return apiError("PATCH /api/invoices/[id]", "Failed to update invoice", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("edit_invoices");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true, storagePath: true, vendor: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const supabase = await createClient();
    await deleteInvoiceDocument(supabase, invoice.storagePath);
    await prisma.invoice.delete({ where: { id } });
    await recordAudit(workspace.id, user.id, "data.invoice_deleted", {
      invoiceId: id,
      vendor: invoice.vendor,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/invoices/[id]", "Failed to delete invoice", error);
  }
}
