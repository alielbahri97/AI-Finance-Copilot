import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { loadScenarioData } from "@/lib/finance/scenario-data";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";

import { requireScenarioAccess, requireScenarioQuota } from "./guard";
import { scenarioCreateSchema } from "./schemas";

/**
 * Listing is not plan-gated: a workspace that downgrades still gets to see the
 * scenarios it named, the same way it still sees the holdings it entered.
 */
export async function GET() {
  try {
    const auth = await requireWorkspace("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { scenarios } = await loadScenarioData(workspace.id);

    return NextResponse.json({ scenarios });
  } catch (error) {
    return apiError("GET /api/scenarios", "Failed to load scenarios", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireScenarioAccess("manage_forecast");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const body = await request.json();
    const parsed = scenarioCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scenario", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    const overQuota = await requireScenarioQuota(workspace.id);
    if (overQuota) return overQuota;

    // The unique index on (workspaceId, name) is the real guard; asking first
    // turns the collision into a sentence the dialog can show.
    const taken = await prisma.scenario.findFirst({
      where: { workspaceId: workspace.id, name: values.name },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: "A scenario already has that name" }, { status: 409 });
    }

    const scenario = await prisma.$transaction(async (tx) => {
      // "Default" is a property of the workspace, held on one row: clearing the
      // others here is what keeps it single-valued.
      if (values.isDefault) {
        await tx.scenario.updateMany({
          where: { workspaceId: workspace.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.scenario.create({
        data: {
          workspaceId: workspace.id,
          name: values.name,
          isDefault: values.isDefault ?? false,
        },
      });
    });

    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/scenarios", "Failed to create the scenario", error);
  }
}
