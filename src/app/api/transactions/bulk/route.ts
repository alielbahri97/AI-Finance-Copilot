import { NextResponse } from "next/server";

import { learnCategoryRulesFromTransactions } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { bulkActionSchema } from "@/lib/validations/transaction";
import { apiError } from "@/lib/api/response";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

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
        where: { id: { in: ids }, workspaceId: workspace.id },
      });
      if (result.count > 0) {
        await recordAudit(workspace.id, user.id, "data.transactions_deleted", {
          count: result.count,
        });
      }
      return NextResponse.json({ affected: result.count });
    }

    // setCategory
    if (parsed.data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: parsed.data.categoryId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
    }

    const owned = await prisma.transaction.findMany({
      where: { id: { in: ids }, workspaceId: workspace.id },
      select: { id: true, description: true, counterparty: true },
    });

    const result = await prisma.transaction.updateMany({
      where: { id: { in: owned.map((tx) => tx.id) }, workspaceId: workspace.id },
      data: { categoryId: parsed.data.categoryId },
    });

    let learnedRules = null;
    if (parsed.data.categoryId && owned.length > 0) {
      learnedRules = await learnCategoryRulesFromTransactions(
        { workspaceId: workspace.id, userId: user.id },
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
