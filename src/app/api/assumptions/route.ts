import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";
import {
  assumptionSchema,
  toAssumptionData,
  validateDateWindow,
} from "@/lib/validations/assumption";

export async function GET() {
  try {
    const auth = await requireWorkspace("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const assumptions = await prisma.assumption.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ assumptions });
  } catch (error) {
    return apiError("GET /api/assumptions", "Failed to load assumptions", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("manage_forecast");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

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

    // Plan gating: what-if assumptions are a paid feature.
    const entitlements = await getEntitlements(workspace.id);
    if (!entitlements.plan.limits.assumptionsEnabled) {
      return NextResponse.json(
        upgradeError("Forecast assumptions", entitlements.planId, entitlements.edition),
        { status: 402 }
      );
    }

    const assumption = await prisma.assumption.create({
      data: { workspaceId: workspace.id, userId: user.id, ...toAssumptionData(parsed.data) },
    });

    return NextResponse.json({ assumption }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/assumptions", "Failed to create assumption", error);
  }
}
