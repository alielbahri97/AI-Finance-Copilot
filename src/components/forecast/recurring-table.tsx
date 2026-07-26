import { RepeatIcon } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecurringItem } from "@/lib/finance/recurrence";
import { formatCurrency, formatDate } from "@/lib/utils";

interface RecurringTableProps {
  items: RecurringItem[];
  currency: string;
  emptyMessage: string;
}

export function RecurringTable({ items, currency, emptyMessage }: RecurringTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
        <RepeatIcon className="size-6 opacity-50" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

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
              {formatDate(item.lastDate)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(item.averageAmount, currency)}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatCurrency(item.monthlyAmount, currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
