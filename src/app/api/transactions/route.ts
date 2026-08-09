import { NextResponse } from "next/server";

import {
  getTransferCategoryIds,
  loadRuleMatchers,
  matchCategoryOrTransfer,
} from "@/lib/categories";
import { loadOwnAccountRefs } from "@/lib/integrations/bank-accounts";
import { evaluateLargeTransactions } from "@/lib/notifications/alerts";
import { prisma } from "@/lib/prisma";
import { transactionSchema } from "@/lib/validations/transaction";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = transactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid transaction", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    let categoryId = parsed.data.categoryId ?? null;
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
    } else {
      const [matchers, accounts, transferIds] = await Promise.all([
        loadRuleMatchers(workspace.id),
        loadOwnAccountRefs(workspace.id),
        getTransferCategoryIds(workspace.id, user.id),
      ]);
      categoryId = matchCategoryOrTransfer(
        matchers,
        parsed.data.description,
        parsed.data.counterparty ?? null,
        parsed.data.type,
        accounts,
        transferIds
      );
    }

    const transaction = await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
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
    await evaluateLargeTransactions(workspace.id, workspace.currency, [
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
