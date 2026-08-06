import { ReceiptIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import type { TransactionSummary } from "@/lib/data";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface LargestExpensesProps {
  expenses: TransactionSummary[];
  currency: string;
}

export function LargestExpenses({ expenses, currency }: LargestExpensesProps) {
  if (expenses.length === 0) {
    return <EmptyState className="h-72" icon={ReceiptIcon} title="No expenses recorded yet" />;
  }

  const locale = localeForCurrency(currency);
  const max = expenses[0]?.amount ?? 1;

  return (
    <div className="flex h-72 flex-col justify-center gap-4">
      {expenses.map((expense) => (
        <div key={expense.id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{expense.description}</span>
              {/* Same reasoning as the recent-transactions list: a DB-supplied
                  hex is only safe as a swatch, not as a text colour. */}
              {expense.category && (
                <span className="text-secondary-foreground hidden shrink-0 items-center gap-1.5 text-xs sm:inline-flex">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      !expense.categoryColor && "bg-muted-foreground/40"
                    )}
                    style={
                      expense.categoryColor
                        ? { backgroundColor: expense.categoryColor }
                        : undefined
                    }
                  />
                  {expense.category}
                </span>
              )}
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatCurrency(expense.amount, currency, locale)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-destructive/70 h-full rounded-full"
                style={{ width: `${Math.max((expense.amount / max) * 100, 4)}%` }}
              />
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatDate(expense.date, locale)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
