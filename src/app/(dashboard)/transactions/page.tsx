import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import {
  TransactionsTable,
  type TransactionRow,
} from "@/components/transactions/transactions-table";
import { Card, CardContent } from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 200,
  });

  const rows: TransactionRow[] = transactions.map((tx) => ({
    id: tx.id,
    type: tx.type,
    amount: Number(tx.amount),
    category: tx.category,
    description: tx.description,
    date: tx.date.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground text-sm">
            All your recorded income and expenses.
          </p>
        </div>
        <TransactionDialog />
      </div>
      <Card>
        <CardContent>
          <TransactionsTable transactions={rows} currency={profile.currency} />
        </CardContent>
      </Card>
    </div>
  );
}
