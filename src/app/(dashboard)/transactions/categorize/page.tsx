import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SparklesIcon, TagsIcon } from "lucide-react";

import { CategorizeQueue } from "@/components/transactions/categorize-queue";
import {
  TEACH_SESSION_SIZE,
  type CategoryOption,
  type TransactionRow,
} from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Teach categories" };
export const dynamic = "force-dynamic";

/**
 * Short teach session: only the largest ~8 uncategorized transactions so a
 * visit feels like five minutes, not an endless backlog.
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
      orderBy: [{ amount: "desc" }, { date: "desc" }, { createdAt: "desc" }],
      take: TEACH_SESSION_SIZE,
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

  const sessionCount = rows.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>5‑min teach session</PageHeading>
          <p className="text-muted-foreground text-sm">
            {sessionCount === 0
              ? "Nothing unlabeled right now."
              : `Label up to ${sessionCount} of the biggest uncategorized transactions — each pick teaches Ballast.`}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/transactions?category=uncategorized&sort=amount&dir=desc">
            <TagsIcon />
            Browse all unlabeled
          </Link>
        </Button>
      </div>

      {sessionCount > 0 && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <SparklesIcon className="text-primary size-4 shrink-0" />
          Session of {sessionCount}
          {totalUncategorized > sessionCount
            ? ` · more waiting after if you want another round`
            : null}
        </p>
      )}

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
