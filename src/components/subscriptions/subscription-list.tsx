import { RepeatIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DetectedSubscription } from "@/lib/personal/subscriptions";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

import { flagExplanation, SubscriptionFlagBadges } from "./subscription-flags";

interface SubscriptionListProps {
  items: DetectedSubscription[];
  currency: string;
  emptyTitle: string;
  emptyDescription: string;
}

export function SubscriptionList({
  items,
  currency,
  emptyTitle,
  emptyDescription,
}: SubscriptionListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={RepeatIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const locale = localeForCurrency(currency);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="hidden sm:table-cell">Cadence</TableHead>
          <TableHead className="hidden md:table-cell">Next charge</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Per month</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const explanation = flagExplanation(item, currency);
          return (
            <TableRow key={item.key}>
              <TableCell className="max-w-72 whitespace-normal">
                <p className="truncate font-medium" title={item.label}>
                  {item.label}
                </p>
                <p className="text-muted-foreground truncate text-xs">{item.category}</p>
                {item.flags.length > 0 ? (
                  <span className="mt-1.5 flex flex-col gap-1">
                    <SubscriptionFlagBadges flags={item.flags} />
                    {explanation ? (
                      <span className="text-muted-foreground text-xs">{explanation}</span>
                    ) : null}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground hidden capitalize sm:table-cell">
                {item.cadence}
                <span className="text-xs"> · {item.timesSeen}x</span>
              </TableCell>
              <TableCell className="text-muted-foreground hidden md:table-cell">
                {item.flags.includes("overdue") ? "—" : formatDate(item.nextChargeAt, locale)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(item.averageAmount, currency, locale)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatCurrency(item.monthlyAmount, currency, locale)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
