import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import {
  assumptionCopies,
  BASE_SCENARIO_ID,
  BASE_SCENARIO_NAME,
  nextCopyName,
  toScenarioColumn,
} from "@/lib/finance/scenarios";
import { prisma } from "@/lib/prisma";

import { requireScenarioAccess, requireScenarioQuota } from "../../guard";
import { scenarioDuplicateSchema } from "../../schemas";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Clone-and-compare is the whole point of scenarios: you take the plan you
 * believe, copy it, change one thing, and look at both.
 *
 * `id` is a scenario id, or the literal `"base"` — duplicating the base
 * scenario copies the `scenario_id IS NULL` assumptions, which is how a
 * workspace that has never used scenarios gets its first real one without
 * retyping anything.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireScenarioAccess("manage_forecast");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const { id } = await context.params;
    const sourceColumn = toScenarioColumn(id);

    let sourceName = BASE_SCENARIO_NAME;
    if (sourceColumn !== null) {
      const source = await prisma.scenario.findFirst({
        where: { id: sourceColumn, workspaceId: workspace.id },
        select: { name: true },
      });
      if (!source) {
        return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
      }
      sourceName = source.name;
    } else if (id !== BASE_SCENARIO_ID) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = scenarioDuplicateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scenario", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const overQuota = await requireScenarioQuota(workspace.id);
    if (overQuota) return overQuota;

    const [existing, assumptions] = await Promise.all([
      prisma.scenario.findMany({ where: { workspaceId: workspace.id }, select: { name: true } }),
      prisma.assumption.findMany({
        where: { workspaceId: workspace.id, scenarioId: sourceColumn },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const taken = existing.map((scenario) => scenario.name);
    const name = parsed.data.name ?? nextCopyName(sourceName, taken);
    if (taken.includes(name)) {
      return NextResponse.json({ error: "A scenario already has that name" }, { status: 409 });
    }

    // One transaction, so a copy is never left half-populated: either the new
    // scenario exists with every assumption of its source, or it does not exist.
    const scenario = await prisma.$transaction(async (tx) => {
      const created = await tx.scenario.create({
        data: { workspaceId: workspace.id, name },
      });
      if (assumptions.length > 0) {
        await tx.assumption.createMany({
          // Whoever pressed duplicate owns the copies; the source rows keep
          // their own author.
          data: assumptionCopies(assumptions, {
            workspaceId: workspace.id,
            userId: user.id,
            scenarioId: created.id,
          }),
        });
      }
      return created;
    });

    return NextResponse.json(
      { scenario, copiedAssumptions: assumptions.length },
      { status: 201 }
    );
  } catch (error) {
    return apiError(
      "POST /api/scenarios/[id]/duplicate",
      "Failed to duplicate the scenario",
      error
    );
  }
}
