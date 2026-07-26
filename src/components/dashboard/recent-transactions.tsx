import Link from "next/link";
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TransactionSummary } from "@/lib/data";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

interface RecentTransactionsProps {
  transactions: TransactionSummary[];
  currency: string;
}

export function RecentTransactions({ transactions, currency }: RecentTransactionsProps) {
  if (transactions.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 py-10 text-center text-sm">
        <p>No transactions yet. Add one manually or import a bank statement.</p>
        <div className="flex gap-2">
          <Button size="sm" asChild>
            <Link href="/import">Import CSV</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/transactions">Add a transaction</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {transactions.map((tx) => (
        <div
          key={tx.id}
          className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors"
        >
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              tx.type === "INCOME" ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"
            )}
          >
            {tx.type === "INCOME" ? (
              <ArrowDownLeftIcon className="size-4" />
            ) : (
              <ArrowUpRightIcon className="size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tx.description}</p>
            <p className="text-muted-foreground text-xs">{formatDate(tx.date)}</p>
          </div>
          <Badge
            variant="secondary"
            className="hidden sm:inline-flex"
            style={
              tx.categoryColor
                ? { backgroundColor: `${tx.categoryColor}22`, color: tx.categoryColor }
                : undefined
            }
          >
            {tx.category ?? "Uncategorized"}
          </Badge>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              tx.type === "INCOME" ? "text-success" : "text-foreground"
            )}
          >
            {tx.type === "INCOME" ? "+" : "-"}
            {formatCurrency(tx.amount, currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
