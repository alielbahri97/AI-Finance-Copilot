import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { invoiceListQuerySchema } from "@/lib/validations/invoice";

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = invoiceListQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      vendor: url.searchParams.get("vendor") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }
    const { status, vendor, from, to } = parsed.data;

    const where: Prisma.InvoiceWhereInput = { userId: user.id };
    if (status === "OVERDUE") {
      where.status = "UNPAID";
      where.dueDate = { lt: new Date() };
    } else if (status) {
      where.status = status;
    }
    if (vendor) {
      where.vendor = { contains: vendor, mode: "insensitive" };
    }
    if (from || to) {
      where.invoiceDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { lineItems: true, transaction: true },
      take: 200,
    });

    return NextResponse.json({ invoices: invoices.map(serializeInvoice) });
  } catch (error) {
    console.error("GET /api/invoices failed:", error);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}
