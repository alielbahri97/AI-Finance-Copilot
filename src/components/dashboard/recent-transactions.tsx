import Link from "next/link";
import { ArrowDownLeftIcon, ArrowUpRightIcon, ReceiptTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { TransactionSummary } from "@/lib/data";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface RecentTransactionsProps {
  transactions: TransactionSummary[];
  currency: string;
}

export function RecentTransactions({ transactions, currency }: RecentTransactionsProps) {
  const locale = localeForCurrency(currency);

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={ReceiptTextIcon}
        title="No transactions yet"
        description="Import a bank statement to bring in months of history at once, or add a single entry by hand."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" asChild>
              <Link href="/import">Import CSV</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/transactions">Add a transaction</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {transactions.map((tx) => (
        <Link
          key={tx.id}
          href={`/transactions?q=${encodeURIComponent(tx.description)}`}
          className="hover:bg-muted/50 focus-visible:ring-ring flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              tx.type === "INCOME" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
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
            <p className="text-muted-foreground text-xs">{formatDate(tx.date, locale)}</p>
          </div>
          {/*
            The category colour is arbitrary user/DB data, so it can only be
            trusted for a solid swatch — never as a foreground. Rendering it as
            text on a 13% tint of itself measured 1.8–3.4:1 depending on the
            hue. This is the same dot-plus-label treatment the category chart
            legend uses, where the readable part is a theme token.
          */}
          <span className="text-secondary-foreground hidden shrink-0 items-center gap-1.5 text-xs sm:inline-flex">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                !tx.categoryColor && "bg-muted-foreground/40"
              )}
              style={tx.categoryColor ? { backgroundColor: tx.categoryColor } : undefined}
            />
            {tx.category ?? "Uncategorized"}
          </span>
          <span
            className={cn(
              "numeric text-sm font-semibold",
              tx.type === "INCOME" ? "text-success" : "text-foreground"
            )}
          >
            {tx.type === "INCOME" ? "+" : "-"}
            {formatCurrency(tx.amount, currency, locale)}
          </span>
        </Link>
      ))}
      <Link
        href="/transactions"
        className="text-muted-foreground hover:text-foreground mt-1 self-start px-2 text-xs underline underline-offset-4"
      >
        View all transactions
      </Link>
    </div>
  );
}
