import { NextResponse } from "next/server";

import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

/**
 * Due-soon (next 7 days) and overdue unpaid invoices. Groundwork for the
 * upcoming notification stage.
 */
export async function GET() {
  try {
    const auth = await requireWorkspace("view_invoices");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const reminders = await getInvoiceReminders(workspace.id);
    return NextResponse.json({ reminders });
  } catch (error) {
    return apiError("GET /api/invoices/reminders", "Failed to load reminders", error);
  }
}
