import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { requireEditionFeature } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

const budgetUpdateSchema = z
  .object({
    limit: z.coerce
      .number()
      .positive("The limit must be greater than zero")
      .max(1_000_000_000, "That limit is too large")
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        "Use at most two decimal places"
      )
      .optional(),
    rollover: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireEditionFeature("budgets", "edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const body = await request.json();
    const parsed = budgetUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid update", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await prisma.budget.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    const budget = await prisma.budget.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ budget: { ...budget, limit: budget.limit.toNumber() } });
  } catch (error) {
    return apiError("PATCH /api/budgets/[id]", "Failed to update budget", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireEditionFeature("budgets", "edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const result = await prisma.budget.deleteMany({ where: { id, workspaceId: workspace.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/budgets/[id]", "Failed to delete budget", error);
  }
}
