import { NextResponse } from "next/server";

import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { getUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/api/response";

/**
 * Due-soon (next 7 days) and overdue unpaid invoices. Groundwork for the
 * upcoming notification stage.
 */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reminders = await getInvoiceReminders(user.id);
    return NextResponse.json({ reminders });
  } catch (error) {
    return apiError("GET /api/invoices/reminders", "Failed to load reminders", error);
  }
}
