import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getOrCreateProfile } from "@/lib/data";
import { isProductTourDone } from "@/lib/tour/steps";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

/**
 * Marks the first-login product tour as done (complete or skip — same flag).
 * Idempotent: a second call is a no-op success.
 */
export async function POST() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await getOrCreateProfile(user);
    const existing = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { tourCompletedAt: true },
    });

    if (isProductTourDone(existing)) {
      return NextResponse.json({
        tourCompletedAt: existing!.tourCompletedAt!.toISOString(),
        alreadyDone: true,
      });
    }

    const profile = await prisma.profile.update({
      where: { id: user.id },
      data: { tourCompletedAt: new Date() },
      select: { tourCompletedAt: true },
    });

    return NextResponse.json({
      tourCompletedAt: profile.tourCompletedAt!.toISOString(),
      alreadyDone: false,
    });
  } catch (error) {
    return apiError("POST /api/tour/complete", "Failed to complete product tour", error);
  }
}
