import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TagsIcon, UploadIcon } from "lucide-react";

import { TableCardSkeleton } from "@/components/dashboard/section-skeletons";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { TransactionsToolbar } from "@/components/transactions/transactions-toolbar";
import { TransactionsExportButton } from "@/components/exports/transactions-export-button";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  DEFAULT_SORT_DIRECTION,
  PAGE_SIZE_OPTIONS,
  SORT_DEFAULT_DIRECTION,
  type BatchOption,
  type CategoryOption,
  type SortDirection,
  type TransactionRow,
  type TransactionSortKey,
} from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

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

function parsePageSize(value: string | undefined): number {
  const size = Number(value);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}

function parseSort(value: string | undefined): TransactionSortKey {
  const keys: TransactionSortKey[] = ["date", "description", "category", "amount"];
  return keys.find((key) => key === value) ?? DEFAULT_SORT;
}

function parseDirection(value: string | undefined): SortDirection {
  return value === "asc" || value === "desc" ? value : DEFAULT_SORT_DIRECTION;
}

/**
 * Sorting has to happen in the query, not on the page we happened to fetch:
 * every column falls back to date so the order stays stable across pages.
 */
function buildOrderBy(
  sort: TransactionSortKey,
  direction: SortDirection
): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case "amount":
      return [{ amount: direction }, { date: "desc" }, { createdAt: "desc" }];
    case "description":
      return [{ description: direction }, { date: "desc" }, { createdAt: "desc" }];
    case "category":
      return [{ category: { name: direction } }, { date: "desc" }, { createdAt: "desc" }];
    default:
      return [{ date: direction }, { createdAt: direction }];
  }
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
  const canExport = ctx.permissions.has("export_data");

  const params = await searchParams;
  const categories = await prisma.category.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, color: true },
  });
  const categoryOptions: CategoryOption[] = categories;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>Transactions</PageHeading>
          <p className="text-muted-foreground text-sm">
            Search and sort everything — or categorize the biggest ones first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button className="rounded-xl" asChild>
              <Link href="/transactions/categorize">
                <TagsIcon />
                Categorize
              </Link>
            </Button>
          )}
          {canEdit && <TransactionDialog categories={categoryOptions} />}
          {canEdit && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/import">
                <UploadIcon />
                Import
              </Link>
            </Button>
          )}
          {canExport && <TransactionsExportButton workspaceId={ctx.workspace.id} />}
        </div>
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
  const pageSize = parsePageSize(first(params, "size"));
  const sortParam = first(params, "sort");
  const dirParam = first(params, "dir");
  // Uncategorized list leads with the biggest amounts unless the user chose a sort.
  const sort: TransactionSortKey = sortParam
    ? parseSort(sortParam)
    : category === "uncategorized"
      ? "amount"
      : DEFAULT_SORT;
  const direction: SortDirection = dirParam
    ? parseDirection(dirParam)
    : SORT_DEFAULT_DIRECTION[sort];

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

  // The totals are aggregated over `where`, so they describe the whole filtered
  // set — the number people actually came for after narrowing to a category.
  const [totalCount, batches, sumsByType] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.importBatch.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    }),
    prisma.transaction.groupBy({ by: ["type"], where, _sum: { amount: true } }),
  ]);

  const income = Number(
    sumsByType.find((entry) => entry.type === "INCOME")?._sum.amount ?? 0
  );
  const expenses = Number(
    sumsByType.find((entry) => entry.type === "EXPENSE")?._sum.amount ?? 0
  );

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: buildOrderBy(sort, direction),
    skip: (page - 1) * pageSize,
    take: pageSize,
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
      <TransactionsToolbar
        categories={categoryOptions}
        batches={batchOptions}
        locale={localeForCurrency(ctx.workspace.currency)}
      />

      <Card>
        <CardContent>
          <TransactionsTable
            transactions={rows}
            categories={categoryOptions}
            currency={ctx.workspace.currency}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            totalCount={totalCount}
            totals={{ income, expenses, net: income - expenses }}
            sort={sort}
            direction={direction}
            canEdit={ctx.permissions.has("edit_transactions")}
            hasActiveFilters={hasActiveFilters}
          />
        </CardContent>
      </Card>
    </>
  );
}
