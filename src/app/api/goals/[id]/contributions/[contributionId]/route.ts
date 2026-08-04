import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { findGoalInWorkspace } from "@/lib/personal/goals-data";
import { prisma } from "@/lib/prisma";

import { requireGoalsAccess } from "../../../guard";

type RouteContext = { params: Promise<{ id: string; contributionId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireGoalsAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id, contributionId } = await context.params;
    // Contributions carry no workspace of their own, so the goal is what proves
    // this row is ours to delete.
    const goal = await findGoalInWorkspace(workspace.id, id);
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    const result = await prisma.savingsContribution.deleteMany({
      where: { id: contributionId, goalId: id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Contribution not found" }, { status: 404 });
    }

    // `achievedAt` is left alone on purpose: the goal was funded, and removing a
    // deposit afterwards corrects the balance without rewriting that history.
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(
      "DELETE /api/goals/[id]/contributions/[contributionId]",
      "Failed to delete contribution",
      error
    );
  }
}
