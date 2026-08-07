import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TagsIcon } from "lucide-react";

import { CategorizeQueue } from "@/components/transactions/categorize-queue";
import type { CategoryOption, TransactionRow } from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Categorize" };
export const dynamic = "force-dynamic";

/** How many largest uncategorized rows to load into the focused review queue. */
const QUEUE_SIZE = 40;

/**
 * Manual categorization focused on impact: uncategorized transactions ordered
 * by amount descending so the biggest numbers are labeled first.
 */
export default async function CategorizeTransactionsPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_transactions")) redirect("/dashboard");

  const canEdit = ctx.permissions.has("edit_transactions");
  const workspaceId = ctx.workspace.id;

  const [categories, totalUncategorized, transactions] = await Promise.all([
    prisma.category.findMany({
      where: { workspaceId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, color: true },
    }),
    prisma.transaction.count({
      where: { workspaceId, categoryId: null },
    }),
    prisma.transaction.findMany({
      where: { workspaceId, categoryId: null },
      // Amounts are stored positive with a type; desc = largest magnitude first.
      orderBy: [{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }],
      take: QUEUE_SIZE,
      include: {
        category: { select: { name: true, color: true } },
        invoice: { select: { id: true, vendor: true } },
      },
    }),
  ]);

  const categoryOptions: CategoryOption[] = categories;
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>Categorize</PageHeading>
          <p className="text-muted-foreground text-sm">
            Label the biggest uncategorized transactions first — skip any you want to leave for
            later.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/transactions?category=uncategorized&sort=amount&dir=desc">
            <TagsIcon />
            All uncategorized
          </Link>
        </Button>
      </div>

      <CategorizeQueue
        initialTransactions={rows}
        totalUncategorized={totalUncategorized}
        categories={categoryOptions}
        currency={ctx.workspace.currency}
        canEdit={canEdit}
      />
    </div>
  );
}
