import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { TEACH_SESSION_SIZE } from "@/components/transactions/types";
import { Button } from "@/components/ui/button";

/**
 * High-visibility invite to a short largest-first teach session — never leads
 * with the full uncategorized backlog count.
 */
export function TeachAiBanner({
  uncategorizedCount,
  canEdit,
}: {
  uncategorizedCount: number;
  canEdit: boolean;
}) {
  if (!canEdit || uncategorizedCount <= 0) return null;

  const sessionCount = Math.min(TEACH_SESSION_SIZE, uncategorizedCount);
  const hasMore = uncategorizedCount > sessionCount;

  return (
    <div className="border-primary/25 from-primary/15 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br px-5 py-5 shadow-xs sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <SparklesIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight">
              Got 5 minutes? Teach Ballast your categories
            </p>
            <p className="text-muted-foreground mt-1 text-sm text-balance">
              {sessionCount === 1
                ? "Start with the biggest unlabeled transaction — Ballast remembers similar merchants."
                : `Start with the ${sessionCount} biggest unlabeled ones so your teaching has the most impact.`}
              {hasMore ? (
                <span className="text-muted-foreground/80"> You can do another short session later.</span>
              ) : null}
            </p>
          </div>
        </div>
        <Button size="lg" className="shrink-0" asChild>
          <Link href="/transactions/categorize">
            <SparklesIcon />
            Start with {sessionCount} biggest
          </Link>
        </Button>
      </div>
    </div>
  );
}
