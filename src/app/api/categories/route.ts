import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { categorySchema } from "@/lib/validations/category";
import { apiError } from "@/lib/api/response";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const categories = await prisma.category.findMany({
      where: { userId: user.id },
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
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid category", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);

    const existing = await prisma.category.findFirst({
      where: { userId: user.id, name: { equals: parsed.data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }

    const category = await prisma.category.create({
      data: { ...parsed.data, userId: user.id },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/categories", "Failed to create category", error);
  }
}
