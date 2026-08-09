"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FileDownIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportKind = "pdf" | "excel" | "csv";

interface ExportButtonsProps {
  /** When true, Excel and PDF are locked; CSV stays available. */
  paidLocked?: boolean;
  /** @deprecated use paidLocked — previously locked all formats including CSV. */
  locked?: boolean;
}

export function ExportButtons({ paidLocked, locked = false }: ExportButtonsProps) {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<ExportKind | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const gatePaid = paidLocked ?? locked;

  async function download(kind: ExportKind, dataset?: "transactions" | "monthly") {
    // Locked buttons stay enabled: a disabled button cannot be focused, so the
    // reason never reaches a keyboard user, and there is nowhere to click
    // through to. Clicking explains the limit and offers the upgrade instead.
    if ((kind === "pdf" || kind === "excel") && gatePaid) {
      setUpgradeOpen(true);
      return;
    }
    setPending(kind);
    try {
      const params = new URLSearchParams();
      for (const key of ["period", "from", "to"] as const) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      if (dataset) params.set("dataset", dataset);

      const response = await fetch(`/api/reports/export/${kind}?${params.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Export failed");
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `report.${kind}`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", { description: fileName });
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending !== null}
        onClick={() => download("pdf")}
      >
        {pending === "pdf" ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : gatePaid ? (
          <LockIcon className="size-4" />
        ) : (
          <FileTextIcon className="size-4" />
        )}
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending !== null}
        onClick={() => download("excel")}
      >
        {pending === "excel" ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : gatePaid ? (
          <LockIcon className="size-4" />
        ) : (
          <FileSpreadsheetIcon className="size-4" />
        )}
        Excel
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending !== null}>
            {pending === "csv" ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <FileDownIcon className="size-4" />
            )}
            CSV
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => download("csv", "transactions")}>
            Transactions
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download("csv", "monthly")}>
            Monthly summary
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excel and PDF need a paid plan</DialogTitle>
            <DialogDescription>
              CSV exports stay free on every plan. Upgrade to download Excel or PDF reports over
              whatever period you have selected — the filters you set here carry into the file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <Link href="/billing">See plans</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
