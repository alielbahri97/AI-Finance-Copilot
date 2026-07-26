"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, Trash2Icon } from "lucide-react";
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
import { cn, formatCurrency, formatDate } from "@/lib/utils";

export interface TransactionRow {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  category: string;
  description: string;
  date: string;
}

interface TransactionsTableProps {
  transactions: TransactionRow[];
  currency: string;
}

export function TransactionsTable({ transactions, currency }: TransactionsTableProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/transactions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete transaction", {
          description: body?.error ?? "Please try again.",
        });
        return;
      }
      toast.success("Transaction deleted");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setDeletingId(null);
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        No transactions yet. Use “Add transaction” to record your first one.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell className="text-muted-foreground">{formatDate(tx.date)}</TableCell>
            <TableCell className="max-w-56 truncate font-medium">{tx.description}</TableCell>
            <TableCell>
              <Badge variant="secondary">{tx.category}</Badge>
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-semibold tabular-nums",
                tx.type === "INCOME" ? "text-success" : "text-foreground"
              )}
            >
              {tx.type === "INCOME" ? "+" : "-"}
              {formatCurrency(tx.amount, currency)}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                onClick={() => handleDelete(tx.id)}
                disabled={deletingId === tx.id}
                aria-label={`Delete ${tx.description}`}
              >
                {deletingId === tx.id ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <Trash2Icon />
                )}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
