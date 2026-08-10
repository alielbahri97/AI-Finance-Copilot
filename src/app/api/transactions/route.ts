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
import {
  buildTransactionOrderBy,
  buildTransactionWhere,
  readTransactionParams,
  resolveDirection,
  resolvePageSize,
  resolvePaging,
  resolveSort,
  serializeBatch,
  serializeTotals,
  serializeTransaction,
  transactionQuerySchema,
} from "@/lib/api/serializers/transactions";
import { requireWorkspace } from "@/lib/workspace/context";

/**
 * The filtered, sorted, paginated ledger — the same query the transactions page
 * runs, with the same param names, defaults and tie-breakers.
 *
 * Two things are deliberately not per-page: `totals` is aggregated over the
 * whole filtered set, because "how much did groceries cost me" is the question
 * a filter is asked; and `batches` lists every import in the workspace, because
 * it populates the filter itself and would otherwise disappear the moment it
 * was used.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request, "view_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const parsed = transactionQuerySchema.safeParse(
      readTransactionParams(new URL(request.url))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    const query = parsed.data;

    const where = buildTransactionWhere(workspace.id, query);
    const pageSize = resolvePageSize(query);
    const sort = resolveSort(query);
    const direction = resolveDirection(query, sort);

    const [totalCount, batches, sumsByType] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.importBatch.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { transactions: true } } },
      }),
      prisma.transaction.groupBy({ by: ["type"], where, _sum: { amount: true } }),
    ]);

    // Asking for page 40 of a set that now has three pages gets the last page,
    // not an empty one.
    const { page, pageCount } = resolvePaging(query, totalCount, pageSize);

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: buildTransactionOrderBy(sort, direction),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: { select: { name: true, color: true } } },
    });

    return NextResponse.json({
      transactions: transactions.map((transaction) =>
        serializeTransaction(transaction, workspace.currency)
      ),
      currency: workspace.currency,
      page,
      pageSize,
      pageCount,
      totalCount,
      sort,
      dir: direction,
      totals: serializeTotals(sumsByType),
      batches: batches.map(serializeBatch),
    });
  } catch (error) {
    return apiError("GET /api/transactions", "Failed to load transactions", error);
  }
}

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
