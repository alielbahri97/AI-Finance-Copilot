import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { isCompedEnterpriseEmail } from "@/lib/billing/plan-overrides";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

/**
 * Marks the complimentary Enterprise celebration as seen.
 * Idempotent: a second call is a no-op success.
 */
export async function POST() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getOrCreateProfile(user);
    if (!isCompedEnterpriseEmail(profile.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (profile.enterprisePromoSeenAt) {
      return NextResponse.json({
        enterprisePromoSeenAt: profile.enterprisePromoSeenAt.toISOString(),
        alreadyDone: true,
      });
    }

    const updated = await prisma.profile.update({
      where: { id: user.id },
      data: { enterprisePromoSeenAt: new Date() },
      select: { enterprisePromoSeenAt: true },
    });

    return NextResponse.json({
      enterprisePromoSeenAt: updated.enterprisePromoSeenAt!.toISOString(),
      alreadyDone: false,
    });
  } catch (error) {
    return apiError(
      "POST /api/billing/enterprise-promo/complete",
      "Failed to complete enterprise promo",
      error
    );
  }
}
