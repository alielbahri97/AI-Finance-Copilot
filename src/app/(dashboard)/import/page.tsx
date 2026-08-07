import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ImportHistory } from "@/components/import/import-history";
import { ImportWizard } from "@/components/import/import-wizard";
import type { BatchOption } from "@/components/transactions/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("edit_transactions")) redirect("/dashboard");

  const batches = await prisma.importBatch.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { _count: { select: { transactions: true } } },
  });

  const batchOptions: BatchOption[] = batches.map((batch) => ({
    id: batch.id,
    fileName: batch.fileName,
    createdAt: batch.createdAt.toISOString(),
    transactionCount: batch._count.transactions,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <PageHeading>Import bank statement</PageHeading>
        <p className="text-muted-foreground text-sm">
          Upload a statement. Duplicates are skipped, and every import can be undone.
        </p>
      </div>

      <ImportWizard currency={ctx.workspace.currency} />

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>Undo an import to remove all transactions it created.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImportHistory batches={batchOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
