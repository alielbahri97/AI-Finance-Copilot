import { NextResponse } from "next/server";

import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { getUser } from "@/lib/supabase/server";

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
    console.error("GET /api/invoices/reminders failed:", error);
    return NextResponse.json({ error: "Failed to load reminders" }, { status: 500 });
  }
}
