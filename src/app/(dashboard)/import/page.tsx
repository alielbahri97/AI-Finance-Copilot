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
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const batches = await prisma.importBatch.findMany({
    where: { userId: user.id },
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import bank statement</h1>
        <p className="text-muted-foreground text-sm">
          Upload a CSV export from your bank. Duplicates are skipped automatically and every
          import can be undone.
        </p>
      </div>

      <ImportWizard currency={profile.currency} />

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
