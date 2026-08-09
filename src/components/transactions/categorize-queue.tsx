"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SkipForwardIcon,
  SparklesIcon,
  TagsIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import {
  TEACH_SESSION_SIZE,
  type CategoryOption,
  type TransactionRow,
} from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface CategorizeQueueProps {
  initialTransactions: TransactionRow[];
  /** Total uncategorized in the workspace — only for quiet secondary copy. */
  totalUncategorized: number;
  categories: CategoryOption[];
  currency: string;
  canEdit: boolean;
}

/**
 * Short teach session: the largest ~8 uncategorized transactions, one big card
 * at a time. Progress is session-scoped so a huge backlog never floods the UI.
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
  const sessionSize = initialTransactions.length;
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
  const sessionIndex = Math.min(
    sessionSize,
    categorizedThisSession + skippedIds.size + (current ? 1 : 0)
  );
  const leftInSession = remaining.length;
  const moreAfterSession = Math.max(0, totalUncategorized - sessionSize);

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
            ? `Taught Ballast: "${learned.pattern}" → ${learned.categoryName}`
            : `Taught Ballast to use ${learned.categoryName} next time`
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
    const nothingToStart = sessionSize === 0;
    return (
      <EmptyState
        icon={CheckCircle2Icon}
        title={
          nothingToStart
            ? "Nothing left to categorize"
            : "Nice — this session is done"
        }
        description={
          skippedIds.size > 0
            ? `You labeled ${categorizedThisSession} and skipped ${skippedIds.size} in this session. Skipped ones stay for next time.`
            : categorizedThisSession > 0
              ? moreAfterSession > 0
                ? `You taught Ballast on ${categorizedThisSession} of the biggest ones. Come back anytime for another short session.`
                : `You labeled ${categorizedThisSession} transaction${categorizedThisSession === 1 ? "" : "s"}. Ballast will reuse what it learned.`
              : "Every transaction already has a category."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {skippedIds.size > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setSkippedIds(new Set());
                }}
              >
                Review skipped
              </Button>
            )}
            {moreAfterSession > 0 && categorizedThisSession > 0 && skippedIds.size === 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  router.refresh();
                }}
              >
                Another {Math.min(TEACH_SESSION_SIZE, moreAfterSession)} biggest
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
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums">
            {sessionIndex} of {sessionSize} in this session
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {leftInSession === 1 ? "1 left in this session" : `${leftInSession} left in this session`}
            {moreAfterSession > 0 ? " · more waiting after" : ""}
          </p>
        </div>
      </div>

      <div className="border-border/60 bg-card rounded-2xl border p-6 shadow-xs sm:p-8">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          <SparklesIcon className="size-3.5" />
          5‑min teach · largest first
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
          <p className="text-sm font-medium">Pick a category — Ballast remembers similar merchants</p>
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
            Up next in this session
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
        </div>
      )}
    </div>
  );
}

function insertByAmountDesc(list: TransactionRow[], tx: TransactionRow): TransactionRow[] {
  if (list.some((row) => row.id === tx.id)) return list;
  const next = [...list, tx];
  next.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date));
  return next;
}
