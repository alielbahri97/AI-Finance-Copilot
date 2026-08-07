"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SkipForwardIcon,
  TagsIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { CategoryOption, TransactionRow } from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

const QUEUE_PAGE_HINT = 40;

interface CategorizeQueueProps {
  initialTransactions: TransactionRow[];
  totalUncategorized: number;
  categories: CategoryOption[];
  currency: string;
  canEdit: boolean;
}

/**
 * Focused review of uncategorized transactions, always largest first.
 * One big card at a time so amount, merchant and category choice dominate.
 */
export function CategorizeQueue({
  initialTransactions,
  totalUncategorized,
  categories,
  currency,
  canEdit,
}: CategorizeQueueProps) {
  const router = useRouter();
  const locale = localeForCurrency(currency);
  const [queue, setQueue] = useState(initialTransactions);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [categorizedThisSession, setCategorizedThisSession] = useState(0);

  const remaining = useMemo(
    () => queue.filter((tx) => !skippedIds.has(tx.id)),
    [queue, skippedIds]
  );
  const current = remaining[0] ?? null;
  const upcoming = remaining.slice(1, 4);
  const leftInWorkspace = Math.max(
    0,
    totalUncategorized - categorizedThisSession - skippedIds.size
  );

  const matchingCategories = useMemo(() => {
    if (!current) return [];
    const preferred = categories.filter((category) => category.type === current.type);
    const other = categories.filter((category) => category.type !== current.type);
    return [...preferred, ...other];
  }, [categories, current]);

  async function categorize(categoryId: string) {
    if (!current || !canEdit || busy) return;
    const tx = current;
    const category = categories.find((entry) => entry.id === categoryId);
    setBusy(true);
    // Advance immediately so the next largest card is ready while the request runs.
    setQueue((prev) => prev.filter((row) => row.id !== tx.id));
    setCategorizedThisSession((count) => count + 1);

    try {
      const response = await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setQueue((prev) => insertByAmountDesc(prev, tx));
        setCategorizedThisSession((count) => Math.max(0, count - 1));
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
            ? `Always categorizing "${learned.pattern}" as ${learned.categoryName}`
            : `We'll categorize similar transactions as ${learned.categoryName} going forward`
        );
      } else if (category) {
        toast.success(`Saved as ${category.name}`);
      }
      router.refresh();
    } catch {
      setQueue((prev) => insertByAmountDesc(prev, tx));
      setCategorizedThisSession((count) => Math.max(0, count - 1));
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusy(false);
    }
  }

  function skipCurrent() {
    if (!current) return;
    setSkippedIds((prev) => new Set(prev).add(current.id));
  }

  if (!canEdit) {
    return (
      <EmptyState
        icon={TagsIcon}
        title="You can view transactions, but not categorize them"
        description="Ask a workspace admin for edit access."
        action={
          <Button variant="outline" asChild>
            <Link href="/transactions">Back to transactions</Link>
          </Button>
        }
      />
    );
  }

  if (!current) {
    const allCaughtUp = totalUncategorized === 0 || remaining.length === 0;
    return (
      <EmptyState
        icon={CheckCircle2Icon}
        title={allCaughtUp && categorizedThisSession === 0 && skippedIds.size === 0
          ? "Nothing left to categorize"
          : "You're done with this batch"}
        description={
          skippedIds.size > 0
            ? `You categorized ${categorizedThisSession} and skipped ${skippedIds.size}. Skipped ones stay uncategorized until you come back.`
            : categorizedThisSession > 0
              ? `Nice — ${categorizedThisSession} transaction${categorizedThisSession === 1 ? "" : "s"} labeled. Largest ones first means the biggest impact is already handled.`
              : "Every transaction already has a category."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {skippedIds.size > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setSkippedIds(new Set());
                  router.refresh();
                }}
              >
                Review skipped
              </Button>
            )}
            <Button asChild>
              <Link href="/transactions">Back to transactions</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const title = current.counterparty?.trim() || current.description;
  const subtitle =
    current.counterparty && current.counterparty !== current.description
      ? current.description
      : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" asChild>
          <Link href="/transactions">
            <ArrowLeftIcon />
            Transactions
          </Link>
        </Button>
        <p className="text-muted-foreground text-sm tabular-nums">
          {leftInWorkspace} left
          {categorizedThisSession > 0 ? ` · ${categorizedThisSession} done` : ""}
        </p>
      </div>

      <div className="border-border/60 bg-card rounded-2xl border p-6 shadow-xs sm:p-8">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Largest uncategorized first
        </p>
        <p
          className={cn(
            "numeric mt-3 text-5xl font-bold tracking-tight sm:text-6xl",
            current.type === "INCOME" ? "text-success" : "text-foreground"
          )}
        >
          {current.type === "INCOME" ? "+" : "−"}
          {formatCurrency(current.amount, currency, locale)}
        </p>
        <p className="mt-4 text-2xl font-semibold tracking-tight text-balance">{title}</p>
        {subtitle && <p className="text-muted-foreground mt-1 text-base text-balance">{subtitle}</p>}
        <div className="text-muted-foreground mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span>{formatDate(current.date, locale)}</span>
          <span aria-hidden>·</span>
          <span>{current.type === "INCOME" ? "Income" : "Expense"}</span>
        </div>

        <div className="mt-8 space-y-3">
          <p className="text-sm font-medium">Pick a category</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {matchingCategories.map((category) => {
              const isPreferred = category.type === current.type;
              return (
                <Button
                  key={category.id}
                  type="button"
                  variant={isPreferred ? "outline" : "ghost"}
                  size="lg"
                  disabled={busy}
                  className={cn(
                    "h-auto min-h-12 justify-start gap-3 px-4 py-3 text-left whitespace-normal",
                    !isPreferred && "text-muted-foreground"
                  )}
                  onClick={() => categorize(category.id)}
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="font-medium">{category.name}</span>
                    {!isPreferred && (
                      <span className="text-muted-foreground text-xs">
                        {category.type === "INCOME" ? "Income" : "Expense"}
                      </span>
                    )}
                  </span>
                  {busy && <Loader2Icon className="text-muted-foreground ml-auto size-4 animate-spin" />}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={skipCurrent}>
            <SkipForwardIcon />
            Skip for now
          </Button>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Up next (largest remaining)
          </p>
          <ul className="flex flex-col gap-2">
            {upcoming.map((tx) => {
              const label = tx.counterparty?.trim() || tx.description;
              return (
                <li
                  key={tx.id}
                  className="border-border/50 bg-muted/30 flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="text-muted-foreground text-xs">{formatDate(tx.date, locale)}</p>
                  </div>
                  <span
                    className={cn(
                      "numeric shrink-0 text-sm font-semibold",
                      tx.type === "INCOME" ? "text-success" : "text-foreground"
                    )}
                  >
                    {tx.type === "INCOME" ? "+" : "−"}
                    {formatCurrency(tx.amount, currency, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
          {totalUncategorized > QUEUE_PAGE_HINT && (
            <p className="text-muted-foreground text-xs">
              Showing the largest {QUEUE_PAGE_HINT} uncategorized. Finish these and refresh to load
              more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Keep the queue sorted by amount descending after a failed categorize rolls back. */
function insertByAmountDesc(list: TransactionRow[], tx: TransactionRow): TransactionRow[] {
  if (list.some((row) => row.id === tx.id)) return list;
  const next = [...list, tx];
  next.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date));
  return next;
}
