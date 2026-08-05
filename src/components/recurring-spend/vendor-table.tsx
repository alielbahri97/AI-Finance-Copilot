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
import type { OverlapGroup, RecurringVendor } from "@/lib/business/recurring-spend";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

import { RecurringSpendFlagBadges, vendorFlagExplanation } from "./recurring-spend-flags";

interface VendorTableProps {
  vendors: RecurringVendor[];
  overlapGroups: OverlapGroup[];
  currency: string;
}

/**
 * The audit itself: every recurring vendor, dearest per month first, with the
 * annual figure beside it. The annual column is the point of the page — a
 * €39/month tool is a rounding error and €468 a year is a decision — and it is
 * safe for any cadence because it is derived from the monthly equivalent, so a
 * quarterly invoice is not counted four times over.
 */
export function VendorTable({ vendors, overlapGroups, currency }: VendorTableProps) {
  if (vendors.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={RepeatIcon}
        title="No recurring vendor charges detected"
        description="A charge counts as recurring once it appears at least three times, in at least two different months, at a steady amount and interval."
      />
    );
  }

  const locale = localeForCurrency(currency);
  const overlapLabels = new Map<string, string[]>();
  for (const group of overlapGroups) {
    for (const key of group.vendorKeys) overlapLabels.set(key, group.vendorLabels);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="hidden sm:table-cell">Cadence</TableHead>
          <TableHead className="hidden lg:table-cell">Next charge</TableHead>
          <TableHead className="text-right">Per month</TableHead>
          <TableHead className="text-right">Per year</TableHead>
          <TableHead className="hidden text-right md:table-cell">Share of spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vendors.map((vendor) => {
          const explanation = vendorFlagExplanation(
            vendor,
            currency,
            overlapLabels.get(vendor.key)
          );
          return (
            <TableRow key={vendor.key}>
              <TableCell className="max-w-72 whitespace-normal">
                <p className="truncate font-medium" title={vendor.label}>
                  {vendor.label}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {vendor.category}
                  {vendor.toolCategory ? ` · ${vendor.toolCategory}` : ""}
                </p>
                {vendor.flags.length > 0 ? (
                  <span className="mt-1.5 flex flex-col gap-1">
                    <RecurringSpendFlagBadges flags={vendor.flags} />
                    {explanation ? (
                      <span className="text-muted-foreground text-xs">{explanation}</span>
                    ) : null}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground hidden capitalize sm:table-cell">
                {vendor.cadence}
                <span className="text-xs"> · {vendor.timesSeen}x</span>
              </TableCell>
              <TableCell className="text-muted-foreground hidden lg:table-cell">
                {vendor.overdue ? "—" : formatDate(vendor.nextChargeAt, locale)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatCurrency(vendor.monthlyAmount, currency, locale)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(vendor.annualisedCost, currency, locale)}
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-right tabular-nums md:table-cell">
                {vendor.expenseShare > 0 ? `${vendor.expenseShare}%` : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
