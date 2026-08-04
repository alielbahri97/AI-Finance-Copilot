import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { categoryRuleSchema } from "@/lib/validations/category";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export async function GET() {
  try {
    const auth = await requireWorkspace("view_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const rules = await prisma.categoryRule.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: { category: { select: { name: true, color: true } } },
    });

    return NextResponse.json({ rules });
  } catch (error) {
    return apiError("GET /api/rules", "Failed to load rules", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = categoryRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid rule", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const category = await prisma.category.findFirst({
      where: { id: parsed.data.categoryId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }

    const existing = await prisma.categoryRule.findFirst({
      where: {
        workspaceId: workspace.id,
        pattern: { equals: parsed.data.pattern, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "A rule with that pattern already exists" }, { status: 409 });
    }

    const rule = await prisma.categoryRule.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        pattern: parsed.data.pattern,
        categoryId: parsed.data.categoryId,
      },
      include: { category: { select: { name: true, color: true } } },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/rules", "Failed to create rule", error);
  }
}
