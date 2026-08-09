"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import {
  TEACH_SESSION_SIZE,
  type CategoryOption,
  type TransactionRow,
} from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface TransactionCategorizeSheetProps {
  transaction: TransactionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
  currency: string;
  canEdit: boolean;
}

/**
 * Visible categorize surface when a row is opened: large money figure and
 * category chips, framed as teaching Ballast for the next similar import.
 */
export function TransactionCategorizeSheet({
  transaction,
  open,
  onOpenChange,
  categories,
  currency,
  canEdit,
}: TransactionCategorizeSheetProps) {
  const router = useRouter();
  const locale = localeForCurrency(currency);
  const [busy, setBusy] = useState(false);

  const matchingCategories = useMemo(() => {
    if (!transaction) return [];
    const preferred = categories.filter((category) => category.type === transaction.type);
    const other = categories.filter((category) => category.type !== transaction.type);
    return [...preferred, ...other];
  }, [categories, transaction]);

  if (!transaction) return null;

  const tx = transaction;
  const title = tx.counterparty?.trim() || tx.description;
  const subtitle =
    tx.counterparty && tx.counterparty !== tx.description ? tx.description : null;
  const needsCategory = !tx.categoryId;

  async function categorize(categoryId: string) {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not update category", { description: body?.error ?? "Try again." });
        return;
      }
      const learned = body?.learnedRule as
        | { pattern?: string; categoryName?: string }
        | null
        | undefined;
      if (learned?.categoryName) {
        toast.success(
          learned.pattern
            ? `Taught Ballast: "${learned.pattern}" → ${learned.categoryName}`
            : `Taught Ballast to use ${learned.categoryName} next time`
        );
      } else {
        toast.success("Category saved");
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92svh] gap-0 overflow-y-auto rounded-t-2xl sm:mx-auto sm:max-w-lg"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-xl">
            {needsCategory ? "Help Ballast learn this one" : "Change category"}
          </SheetTitle>
          <SheetDescription>
            {needsCategory
              ? "Pick a category — Ballast remembers similar merchants so the next import is faster."
              : "Update the label. Matching merchants can learn from this too."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 space-y-6 px-1 pb-6">
          <div className="border-border/60 bg-muted/30 rounded-2xl border px-5 py-5">
            <p
              className={cn(
                "numeric text-4xl font-bold tracking-tight sm:text-5xl",
                transaction.type === "INCOME" ? "text-success" : "text-foreground"
              )}
            >
              {transaction.type === "INCOME" ? "+" : "−"}
              {formatCurrency(transaction.amount, currency, locale)}
            </p>
            <p className="mt-3 text-lg font-semibold tracking-tight">{title}</p>
            {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
            <p className="text-muted-foreground mt-3 text-sm">
              {formatDate(transaction.date, locale)}
              {" · "}
              {transaction.type === "INCOME" ? "Income" : "Expense"}
              {transaction.categoryName ? ` · ${transaction.categoryName}` : " · Uncategorized"}
            </p>
          </div>

          {canEdit ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Pick a category</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {matchingCategories.map((category) => {
                  const isPreferred = category.type === transaction.type;
                  const isCurrent = category.id === transaction.categoryId;
                  return (
                    <Button
                      key={category.id}
                      type="button"
                      variant={isCurrent ? "default" : isPreferred ? "outline" : "ghost"}
                      size="lg"
                      disabled={busy}
                      className={cn(
                        "h-auto min-h-12 justify-start gap-3 px-4 py-3 text-left whitespace-normal",
                        !isPreferred && !isCurrent && "text-muted-foreground"
                      )}
                      onClick={() => categorize(category.id)}
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                        aria-hidden
                      />
                      <span className="font-medium">{category.name}</span>
                      {busy && (
                        <Loader2Icon className="text-muted-foreground ml-auto size-4 animate-spin" />
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">You can view this, but not edit categories.</p>
          )}

          {needsCategory && (
            <div className="bg-primary/10 border-primary/20 flex flex-col gap-3 rounded-2xl border p-4">
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold tracking-tight">Got 5 minutes?</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Start with the {TEACH_SESSION_SIZE} biggest unlabeled ones — each pick teaches
                    Ballast for next time.
                  </p>
                </div>
              </div>
              <Button asChild className="w-full">
                <Link href="/transactions/categorize" onClick={() => onOpenChange(false)}>
                  <SparklesIcon />
                  Start with {TEACH_SESSION_SIZE} biggest
                </Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
