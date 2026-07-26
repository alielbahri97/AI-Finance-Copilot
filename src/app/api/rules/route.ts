import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { categoryRuleSchema } from "@/lib/validations/category";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rules = await prisma.categoryRule.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { category: { select: { name: true, color: true } } },
    });

    return NextResponse.json({ rules });
  } catch (error) {
    console.error("GET /api/rules failed:", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = categoryRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid rule", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const category = await prisma.category.findFirst({
      where: { id: parsed.data.categoryId, userId: user.id },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }

    const existing = await prisma.categoryRule.findFirst({
      where: { userId: user.id, pattern: { equals: parsed.data.pattern, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "A rule with that pattern already exists" }, { status: 409 });
    }

    const rule = await prisma.categoryRule.create({
      data: { userId: user.id, pattern: parsed.data.pattern, categoryId: parsed.data.categoryId },
      include: { category: { select: { name: true, color: true } } },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("POST /api/rules failed:", error);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}
