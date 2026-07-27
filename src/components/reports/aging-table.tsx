import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgingBucket } from "@/lib/reports/data";
import { cn, formatCurrency } from "@/lib/utils";

interface AgingTableProps {
  buckets: AgingBucket[];
  currency: string;
}

/** AR/AP aging summary: current / 1-30 / 31-60 / 60+ days overdue. */
export function AgingTable({ buckets, currency }: AgingTableProps) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);

  if (total === 0 && buckets.every((bucket) => bucket.count === 0)) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        Nothing outstanding
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Age</TableHead>
          <TableHead className="text-right">Invoices</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((bucket, index) => (
          <TableRow key={bucket.label}>
            <TableCell className={cn("font-medium", index >= 2 && "text-destructive")}>
              {bucket.label}
            </TableCell>
            <TableCell className="text-muted-foreground text-right tabular-nums">
              {bucket.count}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(bucket.total, currency)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-muted-foreground text-right tabular-nums">
            {buckets.reduce((sum, bucket) => sum + bucket.count, 0)}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatCurrency(total, currency)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
