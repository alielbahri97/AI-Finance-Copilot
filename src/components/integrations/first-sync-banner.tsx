"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface FirstSyncBannerProps {
  providerId: string;
  providerName: string;
  /** Linked bank accounts, when known (GoCardless); null for Plaid/Tink. */
  accountCount: number | null;
}

interface SyncResult {
  stats: Record<string, number>;
  batchId: string | null;
}

/**
 * Shown right after a bank connection completes: kicks off the first sync
 * and reports what was imported, instead of leaving the user to wonder
 * whether anything happened.
 */
export function FirstSyncBanner({ providerId, providerName, accountCount }: FirstSyncBannerProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<"syncing" | "done" | "error">("syncing");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/integrations/${providerId}/sync`, { method: "POST" });
        const body = (await response.json()) as {
          stats?: Record<string, number>;
          batchId?: string | null;
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "The first sync failed");
        setResult({ stats: body.stats ?? {}, batchId: body.batchId ?? null });
        setPhase("done");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The first sync failed");
        setPhase("error");
      }
    })();
  }, [providerId, router]);

  const accountsLabel =
    accountCount && accountCount > 0
      ? `${accountCount} bank account${accountCount > 1 ? "s" : ""}`
      : "your bank";

  if (phase === "syncing") {
    return (
      <Card role="status" aria-live="polite">
        <CardContent className="flex items-center gap-3 py-4 text-sm">
          <Loader2Icon className="text-muted-foreground size-5 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">
              {providerName} connected — importing transactions from {accountsLabel}…
            </p>
            <p className="text-muted-foreground">
              This usually takes a few seconds. You can keep using the app meanwhile.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card role="status" aria-live="polite">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="font-medium">{providerName} is connected, but the first import hit a snag</p>
            <p className="text-muted-foreground">{error}</p>
            <p className="text-muted-foreground">
              No need to reconnect — syncing retries automatically, or use “Sync now” on the card
              below.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = result?.stats ?? {};
  const imported = stats.imported ?? 0;
  const duplicates = stats.duplicates ?? 0;
  const skipped = stats.accountsSkipped ?? 0;

  return (
    <Card role="status" aria-live="polite">
      <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
        <CheckCircle2Icon className="size-5 shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium">
            {imported > 0
              ? `${imported} transaction${imported === 1 ? "" : "s"} imported from ${providerName}`
              : `${providerName} connected — no new transactions to import`}
            {duplicates > 0 ? ` (${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped)` : ""}
          </p>
          {skipped > 0 ? (
            <p className="text-muted-foreground">
              {skipped} account{skipped === 1 ? "" : "s"} hit the bank&apos;s daily data limit and
              will sync automatically later.
            </p>
          ) : null}
        </div>
        {imported > 0 ? (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={result?.batchId ? `/transactions?batch=${result.batchId}` : "/transactions"}
            >
              View imported transactions
              <ArrowRightIcon className="size-4" />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
