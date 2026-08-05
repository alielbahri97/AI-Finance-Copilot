import { NextResponse } from "next/server";

import { assumptionScenarioSchema } from "@/app/api/scenarios/schemas";
import { apiError } from "@/lib/api/response";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { resolveScenarioColumn } from "@/lib/finance/scenario-data";
import { toScenarioColumn } from "@/lib/finance/scenarios";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";
import {
  assumptionSchema,
  toAssumptionData,
  validateDateWindow,
} from "@/lib/validations/assumption";

/**
 * Every assumption in the workspace, or — with `?scenarioId=` — just the ones
 * in that scenario. Absent means every scenario, which is what this route
 * returned before scenarios existed.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const requested = new URL(request.url).searchParams.get("scenarioId");
    const assumptions = await prisma.assumption.findMany({
      where: {
        workspaceId: workspace.id,
        ...(requested === null ? {} : { scenarioId: toScenarioColumn(requested) }),
      },
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

    // Which scenario it lands in. Absent (or "base") is the base scenario — the
    // NULL column every assumption written before scenarios existed holds — so
    // a client that knows nothing about scenarios still creates valid rows.
    const scenario = assumptionScenarioSchema.safeParse(body);
    const resolved = await resolveScenarioColumn(
      workspace.id,
      scenario.success ? scenario.data.scenarioId : null
    );
    if (!resolved.ok) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const assumption = await prisma.assumption.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        scenarioId: resolved.scenarioId,
        ...toAssumptionData(parsed.data),
      },
    });

    return NextResponse.json({ assumption }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/assumptions", "Failed to create assumption", error);
  }
}
