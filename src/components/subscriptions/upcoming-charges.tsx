import { CalendarClockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { UpcomingCharge } from "@/lib/personal/subscriptions";
import { formatCurrency, formatDate } from "@/lib/utils";

interface UpcomingChargesProps {
  charges: UpcomingCharge[];
  currency: string;
}

export function UpcomingCharges({ charges, currency }: UpcomingChargesProps) {
  if (charges.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
        <CalendarClockIcon className="size-6 opacity-50" />
        <p>Nothing recurring is due in the next 30 days.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {charges.map((charge, index) => (
        <div
          key={`${charge.key}-${charge.date}-${index}`}
          className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
        >
          <div className="bg-accent text-accent-foreground flex size-9 shrink-0 flex-col items-center justify-center rounded-lg leading-none">
            <span className="text-[10px] uppercase">
              {new Date(charge.date).toLocaleDateString("en-US", {
                month: "short",
                timeZone: "UTC",
              })}
            </span>
            <span className="text-sm font-semibold">{new Date(charge.date).getUTCDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{charge.label}</p>
            <p className="text-muted-foreground text-xs">{formatDate(charge.date)}</p>
          </div>
          {charge.kind === "bill" ? (
            <Badge variant="outline" className="hidden sm:inline-flex">
              bill
            </Badge>
          ) : null}
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(charge.amount, currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
