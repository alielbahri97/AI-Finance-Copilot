import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { categoryUpdateSchema } from "@/lib/validations/category";
import { apiError } from "@/lib/api/response";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const parsed = categoryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid update", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await prisma.category.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    if (parsed.data.name) {
      const clash = await prisma.category.findFirst({
        where: {
          userId: user.id,
          id: { not: id },
          name: { equals: parsed.data.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: "A category with that name already exists" },
          { status: 409 }
        );
      }
    }

    const category = await prisma.category.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ category });
  } catch (error) {
    return apiError("PATCH /api/categories/[id]", "Failed to update category", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    // Transactions keep existing but lose the category (FK is SET NULL).
    const result = await prisma.category.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/categories/[id]", "Failed to delete category", error);
  }
}
