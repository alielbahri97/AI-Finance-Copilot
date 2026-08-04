import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import {
  MAX_BUDGET_YEAR,
  MIN_BUDGET_YEAR,
  parsePeriod,
  periodOf,
} from "@/lib/personal/budgets";
import { getBudgetOverview } from "@/lib/personal/budgets-data";
import { prisma } from "@/lib/prisma";
import { requireEditionFeature } from "@/lib/workspace/context";

/** Decimal(12,2) in the database, so anything finer is rejected up front. */
const limitSchema = z.coerce
  .number({ error: "Enter a monthly limit" })
  .positive("The limit must be greater than zero")
  .max(1_000_000_000, "That limit is too large")
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    "Use at most two decimal places"
  );

const budgetSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  limit: limitSchema,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(MIN_BUDGET_YEAR).max(MAX_BUDGET_YEAR),
  rollover: z.boolean().optional().default(false),
});

export async function GET(request: Request) {
  try {
    const auth = await requireEditionFeature("budgets", "view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const params = new URL(request.url).searchParams;
    const period = parsePeriod(
      params.get("year") ?? undefined,
      params.get("month") ?? undefined,
      periodOf(new Date())
    );

    const overview = await getBudgetOverview(workspace.id, period);
    return NextResponse.json(overview);
  } catch (error) {
    return apiError("GET /api/budgets", "Failed to load budgets", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireEditionFeature("budgets", "edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = budgetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid budget", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { categoryId, limit, month, year, rollover } = parsed.data;

    // The name is taken from the verified category rather than the payload:
    // it is half of the uniqueness key, so a caller must not be able to point
    // a budget at a category name this workspace does not own.
    const category = await prisma.category.findFirst({
      where: { id: categoryId, workspaceId: workspace.id },
      select: { id: true, name: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const budget = await prisma.budget.upsert({
      where: {
        workspaceId_category_month_year: {
          workspaceId: workspace.id,
          category: category.name,
          month,
          year,
        },
      },
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        category: category.name,
        categoryId: category.id,
        limit,
        month,
        year,
        rollover,
      },
      update: { categoryId: category.id, limit, rollover },
    });

    return NextResponse.json(
      { budget: { ...budget, limit: budget.limit.toNumber() } },
      { status: 201 }
    );
  } catch (error) {
    return apiError("POST /api/budgets", "Failed to save budget", error);
  }
}
