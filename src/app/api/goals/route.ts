import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getGoalsOverview, toGoalRecord } from "@/lib/personal/goals-data";
import { prisma } from "@/lib/prisma";

import { requireGoalsAccess } from "./guard";
import { verifyGoalLinks } from "./links";
import { goalCreateSchema, startOfUtcDay } from "./schemas";

export async function GET() {
  try {
    const auth = await requireGoalsAccess("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const overview = await getGoalsOverview(workspace.id);

    return NextResponse.json({
      summary: overview.summary,
      goals: overview.goals,
      archived: overview.archived,
    });
  } catch (error) {
    return apiError("GET /api/goals", "Failed to load savings goals", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireGoalsAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = goalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid goal", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    // A deadline that has already passed is a slip of the keyboard on a new
    // goal. An existing goal keeps one it has drifted past, which is exactly
    // what "behind" is there to say.
    if (values.targetDate && values.targetDate < startOfUtcDay()) {
      return NextResponse.json({ error: "Target date cannot be in the past" }, { status: 400 });
    }

    const linkError = await verifyGoalLinks(workspace.id, values);
    if (linkError) return linkError;

    const duplicate = await prisma.savingsGoal.findFirst({
      where: { workspaceId: workspace.id, name: { equals: values.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: "A goal with that name already exists" }, { status: 409 });
    }

    const startingAmount = values.startingAmount ?? 0;
    const goal = await prisma.savingsGoal.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        name: values.name,
        targetAmount: values.targetAmount,
        targetDate: values.targetDate ?? null,
        startingAmount,
        categoryId: values.categoryId ?? null,
        bankAccountId: values.bankAccountId ?? null,
        note: values.note ?? null,
        // Enough already set aside means the goal is met on creation.
        achievedAt: startingAmount >= values.targetAmount ? new Date() : null,
      },
    });

    return NextResponse.json({ goal: toGoalRecord(goal) }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/goals", "Failed to create savings goal", error);
  }
}
