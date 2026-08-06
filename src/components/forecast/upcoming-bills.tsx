import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { UpcomingBill } from "@/lib/finance/forecast";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface UpcomingBillsProps {
  bills: UpcomingBill[];
  currency: string;
}

export function UpcomingBills({ bills, currency }: UpcomingBillsProps) {
  const locale = localeForCurrency(currency);

  if (bills.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={CalendarClockIcon}
        title="No recurring bills detected yet"
        description="Bills are found by spotting the same payment repeating. A few more months of history is usually enough."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/import">Import a statement</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {bills.map((bill, index) => (
        <div
          key={`${bill.label}-${bill.dueDate}-${index}`}
          className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
        >
          <div className="bg-accent text-accent-foreground flex size-9 shrink-0 flex-col items-center justify-center rounded-lg leading-none">
            <span className="text-2xs uppercase">
              {new Date(bill.dueDate).toLocaleDateString(locale, { month: "short" })}
            </span>
            <span className="text-sm font-semibold">{new Date(bill.dueDate).getUTCDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{bill.label}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(bill.dueDate, locale)} · {bill.cadence}
            </p>
          </div>
          {bill.source === "assumption" && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              assumption
            </Badge>
          )}
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(bill.amount, currency, locale)}
          </span>
        </div>
      ))}
    </div>
  );
}
