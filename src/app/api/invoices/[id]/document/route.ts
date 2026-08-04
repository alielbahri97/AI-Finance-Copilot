import { NextResponse } from "next/server";

import { createInvoiceSignedUrl } from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

/** Returns a short-lived signed URL for viewing/downloading the document. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("view_invoices");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { storagePath: true, mimeType: true, fileName: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    // Invoices synced from accounting systems have no stored document.
    if (!invoice.storagePath) {
      return NextResponse.json(
        { error: "This invoice was synced from an integration and has no document attached." },
        { status: 404 }
      );
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
    return apiError("GET /api/invoices/[id]/document", "Failed to load document", error);
  }
}
