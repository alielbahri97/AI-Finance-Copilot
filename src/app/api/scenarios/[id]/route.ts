import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";

import { scenarioUpdateSchema } from "../schemas";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Rename a scenario, or make it the one the forecast page opens on. Not
 * plan-gated (see `../guard.ts`): tidying up what you already have should not
 * require a subscription.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("manage_forecast");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const existing = await prisma.scenario.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true, name: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = scenarioUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scenario", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    if (values.name && values.name !== existing.name) {
      const taken = await prisma.scenario.findFirst({
        where: { workspaceId: workspace.id, name: values.name, id: { not: id } },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json({ error: "A scenario already has that name" }, { status: 409 });
      }
    }

    const scenario = await prisma.$transaction(async (tx) => {
      if (values.isDefault) {
        await tx.scenario.updateMany({
          where: { workspaceId: workspace.id, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.scenario.update({
        where: { id },
        data: {
          ...(values.name === undefined ? {} : { name: values.name }),
          // Unsetting the flag hands the default back to the base scenario,
          // which is where it lives whenever no named scenario claims it.
          ...(values.isDefault === undefined ? {} : { isDefault: values.isDefault }),
        },
      });
    });

    return NextResponse.json({ scenario });
  } catch (error) {
    return apiError("PATCH /api/scenarios/[id]", "Failed to update the scenario", error);
  }
}

/**
 * Deletes a scenario *and the assumptions written into it* — the foreign key
 * cascades, and the confirm dialog says so. Base-scenario assumptions hold a
 * NULL scenario id and are never touched.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("manage_forecast");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const result = await prisma.scenario.deleteMany({
      where: { id, workspaceId: workspace.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/scenarios/[id]", "Failed to delete the scenario", error);
  }
}
