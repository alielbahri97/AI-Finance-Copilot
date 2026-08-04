import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { apiError } from "@/lib/api/response";
import {
  findGoalInWorkspace,
  markAchievedIfFunded,
  toGoalRecord,
} from "@/lib/personal/goals-data";
import { prisma } from "@/lib/prisma";

import { requireGoalsAccess } from "../guard";
import { verifyGoalLinks } from "../links";
import { goalUpdateSchema, startOfUtcDay } from "../schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireGoalsAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const existing = await findGoalInWorkspace(workspace.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = goalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid goal", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    // An overdue goal keeps its date — that is what "behind" reports. Moving a
    // date into the past is still refused, because it can only be a slip.
    const movesDeadline =
      values.targetDate !== undefined &&
      values.targetDate?.getTime() !== existing.targetDate?.getTime();
    if (movesDeadline && values.targetDate && values.targetDate < startOfUtcDay()) {
      return NextResponse.json({ error: "Target date cannot be in the past" }, { status: 400 });
    }

    const linkError = await verifyGoalLinks(workspace.id, values);
    if (linkError) return linkError;

    if (values.name && values.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.savingsGoal.findFirst({
        where: {
          workspaceId: workspace.id,
          name: { equals: values.name, mode: "insensitive" },
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A goal with that name already exists" },
          { status: 409 }
        );
      }
    }

    const data: Prisma.SavingsGoalUncheckedUpdateManyInput = {};
    if (values.name !== undefined) data.name = values.name;
    if (values.targetAmount !== undefined) data.targetAmount = values.targetAmount;
    if (values.targetDate !== undefined) data.targetDate = values.targetDate;
    if (values.startingAmount !== undefined) data.startingAmount = values.startingAmount;
    if (values.categoryId !== undefined) data.categoryId = values.categoryId;
    if (values.bankAccountId !== undefined) data.bankAccountId = values.bankAccountId;
    if (values.note !== undefined) data.note = values.note;
    if (values.archived !== undefined) {
      data.archivedAt = values.archived ? (existing.archivedAt ?? new Date()) : null;
    }

    // Scoped by workspace above; updateMany keeps the write itself scoped too.
    await prisma.savingsGoal.updateMany({ where: { id, workspaceId: workspace.id }, data });

    // A lowered target or a raised starting amount can complete the goal.
    await markAchievedIfFunded(workspace.id, id);

    const updated = await findGoalInWorkspace(workspace.id, id);
    if (!updated) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    return NextResponse.json({ goal: toGoalRecord(updated) });
  } catch (error) {
    return apiError("PATCH /api/goals/[id]", "Failed to update savings goal", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireGoalsAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    // Contributions cascade with the goal, so deleting one leaves nothing behind.
    const result = await prisma.savingsGoal.deleteMany({
      where: { id, workspaceId: workspace.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/goals/[id]", "Failed to delete savings goal", error);
  }
}
