import { ReceiptIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TransactionSummary } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

interface LargestExpensesProps {
  expenses: TransactionSummary[];
  currency: string;
}

export function LargestExpenses({ expenses, currency }: LargestExpensesProps) {
  if (expenses.length === 0) {
    return (
      <div className="text-muted-foreground flex h-72 flex-col items-center justify-center gap-2 text-sm">
        <ReceiptIcon className="size-8 opacity-50" />
        No expenses recorded yet
      </div>
    );
  }

  const max = expenses[0]?.amount ?? 1;

  return (
    <div className="flex h-72 flex-col justify-center gap-4">
      {expenses.map((expense) => (
        <div key={expense.id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{expense.description}</span>
              {expense.category && (
                <Badge
                  variant="secondary"
                  className="hidden shrink-0 sm:inline-flex"
                  style={
                    expense.categoryColor
                      ? { backgroundColor: `${expense.categoryColor}22`, color: expense.categoryColor }
                      : undefined
                  }
                >
                  {expense.category}
                </Badge>
              )}
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatCurrency(expense.amount, currency)}
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
              {formatDate(expense.date)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
