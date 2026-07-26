import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { transactionSchema } from "@/lib/validations/transaction";

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

    await getOrCreateProfile(user);
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: parsed.data.type,
        amount: parsed.data.amount,
        category: parsed.data.category,
        description: parsed.data.description,
        date: parsed.data.date,
      },
    });

    return NextResponse.json(
      { transaction: { ...transaction, amount: Number(transaction.amount) } },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/transactions failed:", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing transaction id" }, { status: 400 });
    }

    // Scoped to the user's id so nobody can delete another user's rows.
    const result = await prisma.transaction.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/transactions failed:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
