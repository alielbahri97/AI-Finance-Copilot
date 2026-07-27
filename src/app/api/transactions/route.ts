import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { evaluateLargeTransactions } from "@/lib/notifications/alerts";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { transactionSchema } from "@/lib/validations/transaction";
import { apiError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = transactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid transaction", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const profile = await getOrCreateProfile(user);

    const categoryId = parsed.data.categoryId ?? null;
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, userId: user.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
    }

    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: parsed.data.type,
        amount: parsed.data.amount,
        categoryId,
        description: parsed.data.description,
        counterparty: parsed.data.counterparty ?? null,
        date: parsed.data.date,
      },
    });

    // Immediate large-transaction alert; never blocks or fails the create.
    await evaluateLargeTransactions(user.id, profile.currency, [
      {
        type: parsed.data.type,
        amount: parsed.data.amount,
        description: parsed.data.description,
        counterparty: parsed.data.counterparty ?? null,
        date: parsed.data.date,
      },
    ]);

    return NextResponse.json(
      { transaction: { ...transaction, amount: Number(transaction.amount), balance: null } },
      { status: 201 }
    );
  } catch (error) {
    return apiError("POST /api/transactions", "Failed to create transaction", error);
  }
}
