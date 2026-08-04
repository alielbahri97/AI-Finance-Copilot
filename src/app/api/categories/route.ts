import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { categorySchema } from "@/lib/validations/category";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export async function GET() {
  try {
    const auth = await requireWorkspace("view_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const categories = await prisma.category.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { _count: { select: { transactions: true } } },
    });

    return NextResponse.json({
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        color: category.color,
        isDefault: category.isDefault,
        transactionCount: category._count.transactions,
      })),
    });
  } catch (error) {
    return apiError("GET /api/categories", "Failed to load categories", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid category", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await prisma.category.findFirst({
      where: {
        workspaceId: workspace.id,
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }

    const category = await prisma.category.create({
      data: { ...parsed.data, workspaceId: workspace.id, userId: user.id },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/categories", "Failed to create category", error);
  }
}
