"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HistoryIcon, Loader2Icon, Undo2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { BatchOption } from "@/components/transactions/types";
import { formatDate } from "@/lib/utils";

interface ImportHistoryProps {
  batches: BatchOption[];
}

export function ImportHistory({ batches }: ImportHistoryProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function undoImport(batch: BatchOption) {
    setBusyId(batch.id);
    try {
      const response = await fetch(`/api/import/batches/${batch.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not undo import", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success("Import undone", {
        description: `Removed ${body?.removedTransactions ?? batch.transactionCount} transactions from ${batch.fileName}.`,
      });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  if (batches.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={HistoryIcon}
        title="No imports yet"
        description="Every file you upload is listed here, and each one can be undone in a single step."
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {batches.map((batch) => (
        <div
          key={batch.id}
          className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{batch.fileName}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(batch.createdAt)} · {batch.transactionCount} transaction
              {batch.transactionCount === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busyId === batch.id}
            onClick={() => undoImport(batch)}
          >
            {busyId === batch.id ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <Undo2Icon />
            )}
            Undo
          </Button>
        </div>
      ))}
    </div>
  );
}
