import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PartyTotal } from "@/lib/reports/data";
import { formatCurrency } from "@/lib/utils";

interface PartyTableProps {
  data: PartyTotal[];
  currency: string;
  partyLabel: string;
  emptyLabel: string;
}

/** Ranked list of counterparties (top vendors or top customers). */
export function PartyTable({ data, currency, partyLabel, emptyLabel }: PartyTableProps) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        {emptyLabel}
      </div>
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
              {formatCurrency(entry.total, currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
