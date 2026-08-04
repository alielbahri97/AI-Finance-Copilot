import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UploadIcon } from "lucide-react";

import { TableCardSkeleton } from "@/components/dashboard/section-skeletons";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { TransactionsToolbar } from "@/components/transactions/transactions-toolbar";
import type {
  BatchOption,
  CategoryOption,
  TransactionRow,
} from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = { [key: string]: string | string[] | undefined };

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseDateParam(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseAmountParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amount = Number(value);
  return Number.isNaN(amount) || amount < 0 ? undefined : amount;
}

/**
 * Streams: the header with its actions paints as soon as the (cheap)
 * category list resolves; the filtered table follows behind Suspense.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_transactions")) redirect("/dashboard");
  const canEdit = ctx.permissions.has("edit_transactions");

  const params = await searchParams;
  const categories = await prisma.category.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, color: true },
  });
  const categoryOptions: CategoryOption[] = categories;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground text-sm">
            Search, filter and categorize your income and expenses.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <TransactionDialog categories={categoryOptions} />
            <Button asChild>
              <Link href="/import">
                <UploadIcon />
                Import CSV
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Suspense fallback={<TableCardSkeleton />}>
        <TransactionsContent ctx={ctx} params={params} categories={categoryOptions} />
      </Suspense>
    </div>
  );
}

async function TransactionsContent({
  ctx,
  params,
  categories: categoryOptions,
}: {
  ctx: WorkspaceContext;
  params: SearchParams;
  categories: CategoryOption[];
}) {
  const q = first(params, "q")?.trim();
  const type = first(params, "type");
  const category = first(params, "category");
  const batch = first(params, "batch");
  const from = parseDateParam(first(params, "from"));
  const to = parseDateParam(first(params, "to"), true);
  const min = parseAmountParam(first(params, "min"));
  const max = parseAmountParam(first(params, "max"));
  const requestedPage = Math.max(1, Number(first(params, "page") ?? "1") || 1);

  const where: Prisma.TransactionWhereInput = { workspaceId: ctx.workspace.id };
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { counterparty: { contains: q, mode: "insensitive" } },
    ];
  }
  if (type === "INCOME" || type === "EXPENSE") where.type = type;
  if (category === "uncategorized") where.categoryId = null;
  else if (category) where.categoryId = category;
  if (batch) where.importBatchId = batch;
  if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
  if (min !== undefined || max !== undefined) {
    where.amount = { ...(min !== undefined && { gte: min }), ...(max !== undefined && { lte: max }) };
  }

  const [totalCount, batches] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.importBatch.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      category: { select: { name: true, color: true } },
      invoice: { select: { id: true, vendor: true } },
    },
  });

  const rows: TransactionRow[] = transactions.map((tx) => ({
    id: tx.id,
    type: tx.type,
    amount: Number(tx.amount),
    categoryId: tx.categoryId,
    categoryName: tx.category?.name ?? null,
    categoryColor: tx.category?.color ?? null,
    description: tx.description,
    counterparty: tx.counterparty,
    date: tx.date.toISOString(),
    importBatchId: tx.importBatchId,
    invoiceId: tx.invoice?.id ?? null,
    invoiceVendor: tx.invoice?.vendor ?? null,
  }));

  const batchOptions: BatchOption[] = batches.map((entry) => ({
    id: entry.id,
    fileName: entry.fileName,
    createdAt: entry.createdAt.toISOString(),
    transactionCount: entry._count.transactions,
  }));

  const hasActiveFilters = Boolean(q || type || category || batch || from || to || min || max);

  return (
    <>
      <TransactionsToolbar categories={categoryOptions} batches={batchOptions} />

      <Card>
        <CardContent>
          <TransactionsTable
            transactions={rows}
            categories={categoryOptions}
            currency={ctx.workspace.currency}
            page={page}
            pageCount={pageCount}
            totalCount={totalCount}
            hasActiveFilters={hasActiveFilters}
          />
        </CardContent>
      </Card>
    </>
  );
}
