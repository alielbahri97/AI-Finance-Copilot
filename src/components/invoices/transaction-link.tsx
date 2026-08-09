"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2Icon, Link2OffIcon, Loader2Icon, SearchCheckIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { InvoiceDto } from "@/lib/invoices/serialize";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface MatchDto {
  transactionId: string;
  score: number;
  transaction: {
    id: string;
    amount: number;
    date: string;
    description: string;
    counterparty: string | null;
  };
}

interface TransactionLinkProps {
  invoice: InvoiceDto;
}

/**
 * Shows the linked bank transaction, or suggested matches (amount, date and
 * vendor similarity) with one-click linking. Linking marks the invoice paid.
 */
export function TransactionLink({ invoice }: TransactionLinkProps) {
  const router = useRouter();
  const locale = localeForCurrency(invoice.currency);
  const [matches, setMatches] = useState<MatchDto[] | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loadMatches = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/matches`);
      const body = await response.json().catch(() => null);
      setMatches(response.ok ? (body?.matches ?? []) : []);
    } catch {
      setMatches([]);
    }
  }, [invoice.id]);

  useEffect(() => {
    if (!invoice.transaction) loadMatches();
  }, [invoice.transaction, loadMatches]);

  async function link(transactionId: string) {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not link transaction", { description: body?.error });
        return;
      }
      toast.success("Transaction linked", { description: "The invoice is now marked as paid." });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsBusy(false);
    }
  }

  async function unlink() {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/link`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not unlink", { description: body?.error });
        return;
      }
      toast.success("Transaction unlinked", { description: "The invoice is back to unpaid." });
      setMatches(null);
      router.refresh();
      loadMatches();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsBusy(false);
    }
  }

  if (invoice.transaction) {
    const tx = invoice.transaction;
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <div className="bg-success/10 text-success flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Link2Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tx.description}</p>
          <p className="text-muted-foreground text-xs">
            {formatDate(tx.date, locale)}
            {tx.counterparty ? ` · ${tx.counterparty}` : ""} ·{" "}
            {formatCurrency(tx.amount, invoice.currency, locale)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={unlink} disabled={isBusy}>
          {isBusy ? <Loader2Icon className="animate-spin" /> : <Link2OffIcon />}
          Unlink
        </Button>
      </div>
    );
  }

  if (matches === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        Looking for matching transactions…
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <EmptyState
        className="rounded-lg border border-dashed py-8"
        icon={SearchCheckIcon}
        title="No likely match found"
        description="Matching looks for a bank transaction with a similar amount, date and vendor. Import the period this invoice falls in and check again."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/import">Import bank data</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        Suggested matches (amount, date and vendor similarity). Linking marks the invoice paid.
      </p>
      {matches.map((match) => (
        <div key={match.transactionId} className="flex items-center gap-3 rounded-lg border p-3">
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {Math.round(match.score * 100)}%
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{match.transaction.description}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(match.transaction.date, locale)}
              {match.transaction.counterparty ? ` · ${match.transaction.counterparty}` : ""} ·{" "}
              {formatCurrency(match.transaction.amount, invoice.currency, locale)}
            </p>
          </div>
          <Button size="sm" onClick={() => link(match.transactionId)} disabled={isBusy}>
            <Link2Icon />
            Link
          </Button>
        </div>
      ))}
    </div>
  );
}
