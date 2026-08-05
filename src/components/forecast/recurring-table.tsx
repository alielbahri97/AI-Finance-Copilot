import Link from "next/link";
import { RepeatIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecurringItem } from "@/lib/finance/recurrence";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface RecurringTableProps {
  items: RecurringItem[];
  currency: string;
  emptyTitle: string;
}

export function RecurringTable({ items, currency, emptyTitle }: RecurringTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={RepeatIcon}
        title={emptyTitle}
        description="Detection needs the same amount to land on a regular rhythm before it counts as recurring."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/import">Import more history</Link>
          </Button>
        }
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
          <TableHead className="hidden md:table-cell">Last seen</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Per month</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="max-w-48">
              <p className="truncate font-medium" title={item.label}>
                {item.label}
              </p>
              <p className="text-muted-foreground truncate text-xs">{item.category}</p>
            </TableCell>
            <TableCell className="text-muted-foreground hidden capitalize sm:table-cell">
              {item.cadence}
              <span className="text-xs"> · {item.timesSeen}x</span>
            </TableCell>
            <TableCell className="text-muted-foreground hidden md:table-cell">
              {formatDate(item.lastDate, locale)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(item.averageAmount, currency, locale)}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatCurrency(item.monthlyAmount, currency, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
