import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/api/response";

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
    return apiError("GET /api/forecast", "Failed to compute forecast", error);
  }
}
