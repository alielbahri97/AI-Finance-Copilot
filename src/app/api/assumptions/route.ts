import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import {
  assumptionSchema,
  toAssumptionData,
  validateDateWindow,
} from "@/lib/validations/assumption";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assumptions = await prisma.assumption.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ assumptions });
  } catch (error) {
    return apiError("GET /api/assumptions", "Failed to load assumptions", error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = assumptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assumption", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const windowError = validateDateWindow(parsed.data);
    if (windowError) {
      return NextResponse.json({ error: windowError }, { status: 400 });
    }

    await getOrCreateProfile(user);

    // Plan gating: what-if assumptions are a paid feature.
    const entitlements = await getEntitlements(user.id);
    if (!entitlements.plan.limits.assumptionsEnabled) {
      return NextResponse.json(upgradeError("Forecast assumptions", entitlements.planId), {
        status: 402,
      });
    }

    const assumption = await prisma.assumption.create({
      data: { userId: user.id, ...toAssumptionData(parsed.data) },
    });

    return NextResponse.json({ assumption }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/assumptions", "Failed to create assumption", error);
  }
}
