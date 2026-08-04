import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import {
  findGoalInWorkspace,
  markAchievedIfFunded,
  toContributionRecord,
  transactionBelongsToWorkspace,
} from "@/lib/personal/goals-data";
import { prisma } from "@/lib/prisma";

import { requireGoalsAccess } from "../../guard";
import { contributionCreateSchema, endOfUtcDay } from "../../schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireGoalsAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const goal = await findGoalInWorkspace(workspace.id, id);
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = contributionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid contribution", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    // Money that has not moved yet would inflate today's progress.
    if (values.date > endOfUtcDay()) {
      return NextResponse.json({ error: "Date cannot be in the future" }, { status: 400 });
    }

    if (values.transactionId) {
      if (!(await transactionBelongsToWorkspace(workspace.id, values.transactionId))) {
        return NextResponse.json({ error: "Unknown transaction" }, { status: 400 });
      }
      // The unique index on (goalId, transactionId) is the real guard; asking
      // first turns the collision into a clear answer instead of a 500.
      const already = await prisma.savingsContribution.findFirst({
        where: { goalId: id, transactionId: values.transactionId },
        select: { id: true },
      });
      if (already) {
        return NextResponse.json(
          { error: "That transaction is already recorded for this goal" },
          { status: 409 }
        );
      }
    }

    const contribution = await prisma.savingsContribution.create({
      data: {
        goalId: id,
        amount: values.amount,
        date: values.date,
        note: values.note ?? null,
        transactionId: values.transactionId ?? null,
      },
    });

    const achievedAt = await markAchievedIfFunded(workspace.id, id);

    return NextResponse.json(
      { contribution: toContributionRecord(contribution), achievedAt },
      { status: 201 }
    );
  } catch (error) {
    return apiError(
      "POST /api/goals/[id]/contributions",
      "Failed to record contribution",
      error
    );
  }
}
