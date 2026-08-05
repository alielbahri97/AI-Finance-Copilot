"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PencilIcon, Trash2Icon, TrendingUpIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ASSET_KIND_LABELS } from "@/lib/personal/net-worth";
import { formatCurrency, formatDate } from "@/lib/utils";

import type { HoldingRow } from "./types";

interface HoldingsTableProps {
  rows: HoldingRow[];
  currency: string;
  canEdit: boolean;
  onEdit: (holding: HoldingRow) => void;
  onUpdateValue: (holding: HoldingRow) => void;
  emptyMessage: string;
}

/**
 * One side of the balance sheet. Assets and debts share this table: the only
 * difference between them is the arithmetic, and a second nearly identical
 * component would be two places to fix a formatting bug.
 */
export function HoldingsTable({
  rows,
  currency,
  canEdit,
  onEdit,
  onUpdateValue,
  emptyMessage,
}: HoldingsTableProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(holding: HoldingRow) {
    setBusy(holding.id);
    try {
      const response = await fetch(`/api/net-worth/${holding.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not delete", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(`${holding.name} removed`, {
        description: "Its valuation history went with it.",
      });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden sm:table-cell">Kind</TableHead>
          <TableHead className="hidden md:table-cell">Last valued</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">Value</TableHead>
          {canEdit ? <TableHead className="w-px" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((holding) => (
          <TableRow key={holding.id}>
            <TableCell className="max-w-72 whitespace-normal">
              <p className="truncate font-medium" title={holding.name}>
                {holding.name}
              </p>
              {holding.note ? (
                <p className="text-muted-foreground truncate text-xs">{holding.note}</p>
              ) : null}
              {holding.reason === "unvalued" ? (
                <Badge variant="secondary" className="mt-1">
                  Needs a value
                </Badge>
              ) : null}
              {holding.reason === "other-currency" ? (
                <Badge variant="outline" className="mt-1">
                  {holding.currency} · not in the total
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground hidden sm:table-cell">
              {ASSET_KIND_LABELS[holding.kind]}
            </TableCell>
            <TableCell className="text-muted-foreground hidden md:table-cell">
              {holding.asOf ? formatDate(holding.asOf) : "—"}
              {holding.valuationCount > 1 ? (
                <span className="text-xs"> · {holding.valuationCount} figures</span>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {holding.change === null || holding.change === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span
                  className={
                    // Up is good for an asset and bad for a debt, so the colour
                    // follows what the movement means rather than its sign.
                    holding.change > 0 === !holding.isLiability
                      ? "text-success"
                      : "text-destructive"
                  }
                >
                  {holding.change > 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(holding.change), currency)}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatCurrency(holding.value, currency)}
            </TableCell>
            {canEdit ? (
              <TableCell className="text-right whitespace-nowrap">
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-8"
                  onClick={() => onUpdateValue(holding)}
                  aria-label={`Update the value of ${holding.name}`}
                >
                  <TrendingUpIcon />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-8"
                  onClick={() => onEdit(holding)}
                  aria-label={`Edit ${holding.name}`}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive size-8"
                  disabled={busy === holding.id}
                  onClick={() => remove(holding)}
                  aria-label={`Delete ${holding.name}`}
                >
                  {busy === holding.id ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
