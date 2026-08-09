import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

/**
 * Marks the one-shot welcome/Enterprise celebration as seen for any member.
 * Idempotent: a second call is a no-op success.
 */
export async function POST() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getOrCreateProfile(user);

    if (profile.celebrationSeenAt) {
      return NextResponse.json({
        celebrationSeenAt: profile.celebrationSeenAt.toISOString(),
        alreadyDone: true,
      });
    }

    const updated = await prisma.profile.update({
      where: { id: user.id },
      data: { celebrationSeenAt: new Date() },
      select: { celebrationSeenAt: true },
    });

    return NextResponse.json({
      celebrationSeenAt: updated.celebrationSeenAt!.toISOString(),
      alreadyDone: false,
    });
  } catch (error) {
    return apiError(
      "POST /api/celebration/complete",
      "Failed to complete celebration",
      error
    );
  }
}
