import { CalendarClockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { UpcomingCharge } from "@/lib/personal/subscriptions";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface UpcomingChargesProps {
  charges: UpcomingCharge[];
  currency: string;
}

export function UpcomingCharges({ charges, currency }: UpcomingChargesProps) {
  const locale = localeForCurrency(currency);

  if (charges.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={CalendarClockIcon}
        title="Nothing due in the next 30 days"
        description="Every subscription and bill we track is charged later than that."
      />
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
            <span className="text-2xs uppercase">
              {new Date(charge.date).toLocaleDateString(locale, {
                month: "short",
                timeZone: "UTC",
              })}
            </span>
            <span className="text-sm font-semibold">{new Date(charge.date).getUTCDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{charge.label}</p>
            <p className="text-muted-foreground text-xs">{formatDate(charge.date, locale)}</p>
          </div>
          {charge.kind === "bill" ? (
            <Badge variant="outline" className="hidden sm:inline-flex">
              bill
            </Badge>
          ) : null}
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(charge.amount, currency, locale)}
          </span>
        </div>
      ))}
    </div>
  );
}
