import { NextResponse } from "next/server";

import { learnCategoryRulesFromTransactions } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { bulkActionSchema } from "@/lib/validations/transaction";
import { apiError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = bulkActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid bulk action", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { action, ids } = parsed.data;

    if (action === "delete") {
      const result = await prisma.transaction.deleteMany({
        where: { id: { in: ids }, userId: user.id },
      });
      return NextResponse.json({ affected: result.count });
    }

    // setCategory
    if (parsed.data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: parsed.data.categoryId, userId: user.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
    }

    const owned = await prisma.transaction.findMany({
      where: { id: { in: ids }, userId: user.id },
      select: { id: true, description: true, counterparty: true },
    });

    const result = await prisma.transaction.updateMany({
      where: { id: { in: owned.map((tx) => tx.id) }, userId: user.id },
      data: { categoryId: parsed.data.categoryId },
    });

    let learnedRules = null;
    if (parsed.data.categoryId && owned.length > 0) {
      learnedRules = await learnCategoryRulesFromTransactions(
        user.id,
        parsed.data.categoryId,
        owned
      );
    }

    return NextResponse.json({
      affected: result.count,
      learnedRules,
    });
  } catch (error) {
    return apiError("POST /api/transactions/bulk", "Bulk action failed", error);
  }
}
