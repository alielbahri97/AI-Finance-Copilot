import { NextResponse } from "next/server";

import { learnCategoryRule } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { transactionUpdateSchema } from "@/lib/validations/transaction";
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
    const parsed = transactionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid update", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        description: true,
        counterparty: true,
        categoryId: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (parsed.data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: parsed.data.categoryId, userId: user.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
    }

    const transaction = await prisma.transaction.update({
      where: { id },
      data: parsed.data,
      include: { category: { select: { name: true, color: true } } },
    });

    let learnedRule = null;
    const categoryChanged =
      parsed.data.categoryId !== undefined && parsed.data.categoryId !== existing.categoryId;
    if (categoryChanged && parsed.data.categoryId) {
      learnedRule = await learnCategoryRule(user.id, {
        description: parsed.data.description ?? existing.description,
        counterparty:
          parsed.data.counterparty !== undefined
            ? parsed.data.counterparty
            : existing.counterparty,
        categoryId: parsed.data.categoryId,
      });
    }

    return NextResponse.json({
      transaction: {
        ...transaction,
        amount: Number(transaction.amount),
        balance: transaction.balance === null ? null : Number(transaction.balance),
      },
      learnedRule,
    });
  } catch (error) {
    return apiError("PATCH /api/transactions/[id]", "Failed to update transaction", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const result = await prisma.transaction.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/transactions/[id]", "Failed to delete transaction", error);
  }
}
