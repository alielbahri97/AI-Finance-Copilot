import { UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PartyTotal } from "@/lib/reports/data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

interface PartyTableProps {
  data: PartyTotal[];
  currency: string;
  partyLabel: string;
  emptyLabel: string;
}

/** Ranked list of counterparties (top vendors or top customers). */
export function PartyTable({ data, currency, partyLabel, emptyLabel }: PartyTableProps) {
  const locale = localeForCurrency(currency);

  if (data.length === 0) {
    return (
      <EmptyState
        className="h-40"
        icon={UsersIcon}
        title={emptyLabel}
        description="Transactions need a counterparty before they can be ranked here."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>{partyLabel}</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((entry, index) => (
          <TableRow key={entry.name}>
            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
            <TableCell className="max-w-48 truncate font-medium">{entry.name}</TableCell>
            <TableCell className="text-muted-foreground text-right tabular-nums">
              {entry.count}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(entry.total, currency, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
