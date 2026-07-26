import { CalendarClockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { UpcomingBill } from "@/lib/finance/forecast";
import { formatCurrency, formatDate } from "@/lib/utils";

interface UpcomingBillsProps {
  bills: UpcomingBill[];
  currency: string;
}

export function UpcomingBills({ bills, currency }: UpcomingBillsProps) {
  if (bills.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
        <CalendarClockIcon className="size-6 opacity-50" />
        <p>No recurring bills detected yet. Import more history to find patterns.</p>
      </div>
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
            <span className="text-[10px] uppercase">
              {new Date(bill.dueDate).toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className="text-sm font-semibold">{new Date(bill.dueDate).getUTCDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{bill.label}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(bill.dueDate)} · {bill.cadence}
            </p>
          </div>
          {bill.source === "assumption" && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              assumption
            </Badge>
          )}
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(bill.amount, currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
