"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDownIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportKind = "pdf" | "excel" | "csv";

interface ExportButtonsProps {
  /** Plan gating: exports are a paid feature. */
  locked?: boolean;
}

export function ExportButtons({ locked = false }: ExportButtonsProps) {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<ExportKind | null>(null);
  const lockTitle = locked ? "Exports require the Pro plan — upgrade on the Billing page" : undefined;

  async function download(kind: ExportKind, dataset?: "transactions" | "monthly") {
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
        disabled={locked || pending !== null}
        title={lockTitle}
        onClick={() => download("pdf")}
      >
        {pending === "pdf" ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <FileTextIcon className="size-4" />
        )}
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={locked || pending !== null}
        title={lockTitle}
        onClick={() => download("excel")}
      >
        {pending === "excel" ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <FileSpreadsheetIcon className="size-4" />
        )}
        Excel
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={locked || pending !== null} title={lockTitle}>
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
    </div>
  );
}
