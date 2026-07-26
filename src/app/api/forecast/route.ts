import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getUser } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Returns the full forecast, recomputed from current data on every request. */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getOrCreateProfile(user);
    const forecast = await buildForecast(user.id, profile.currency);

    return NextResponse.json({ forecast });
  } catch (error) {
    console.error("GET /api/forecast failed:", error);
    return NextResponse.json({ error: "Failed to compute forecast" }, { status: 500 });
  }
}
