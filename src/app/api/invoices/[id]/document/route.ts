import { NextResponse } from "next/server";

import { createInvoiceSignedUrl } from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";
import { createClient, getUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Returns a short-lived signed URL for viewing/downloading the document. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId: user.id },
      select: { storagePath: true, mimeType: true, fileName: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const supabase = await createClient();
    const url = await createInvoiceSignedUrl(supabase, invoice.storagePath);
    if (!url) {
      return NextResponse.json(
        {
          error:
            "Could not sign the document URL. Check the 'invoices' bucket setup in Supabase (see README).",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ url, mimeType: invoice.mimeType, fileName: invoice.fileName });
  } catch (error) {
    console.error("GET /api/invoices/[id]/document failed:", error);
    return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
  }
}
