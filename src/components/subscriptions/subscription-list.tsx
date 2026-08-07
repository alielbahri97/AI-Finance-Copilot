import { RepeatIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { MoneyText } from "@/components/ui/money-text";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DetectedSubscription } from "@/lib/personal/subscriptions";
import { formatDate, localeForCurrency } from "@/lib/utils";

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
    <>
      <div className="flex flex-col gap-2 sm:hidden">
        {items.map((item) => {
          const explanation = flagExplanation(item, currency);
          return (
            <div
              key={item.key}
              className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.category}
                    <span className="capitalize"> · {item.cadence}</span>
                    {item.flags.includes("overdue")
                      ? null
                      : ` · next ${formatDate(item.nextChargeAt, locale)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <MoneyText
                    amount={item.monthlyAmount}
                    currency={currency}
                    locale={locale}
                    size="md"
                  />
                  <p className="text-muted-foreground text-xs">per month</p>
                </div>
              </div>
              {item.flags.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <SubscriptionFlagBadges flags={item.flags} />
                  {explanation ? (
                    <span className="text-muted-foreground text-xs">{explanation}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="hidden md:table-cell">Cadence</TableHead>
              <TableHead className="hidden lg:table-cell">Next charge</TableHead>
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
                  <TableCell className="text-muted-foreground hidden capitalize md:table-cell">
                    {item.cadence}
                    <span className="text-xs"> · {item.timesSeen}x</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                    {item.flags.includes("overdue") ? "—" : formatDate(item.nextChargeAt, locale)}
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText
                      amount={item.averageAmount}
                      currency={currency}
                      locale={locale}
                      size="sm"
                      tone="muted"
                      className="font-medium"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText
                      amount={item.monthlyAmount}
                      currency={currency}
                      locale={locale}
                      size="md"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
