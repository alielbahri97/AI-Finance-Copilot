"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDownIcon, Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type DataExportFormat = "csv" | "excel" | "pdf" | "zip";

export interface DataExportOption {
  format: DataExportFormat;
  label: string;
  /** Extra query params merged into the request. */
  params?: Record<string, string>;
  /** Paid formats are locked when the plan lacks exportsEnabled. */
  paid?: boolean;
  /**
   * When true, do not send `format=` (routes like /full, /dashboard, /banks,
   * /audit that only support one response type).
   */
  omitFormatParam?: boolean;
}

interface DataExportMenuProps {
  /** Absolute API path, e.g. `/api/exports/transactions`. */
  href: string;
  options: DataExportOption[];
  /** When true, paid options show as locked. */
  paidLocked?: boolean;
  /** Forward current page search params (filters) into the export URL. */
  forwardSearchParams?: string[];
  label?: string;
  size?: "sm" | "default";
}

async function triggerDownload(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Export failed");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "export";
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  toast.success("Export ready", { description: fileName });
}

export function DataExportMenu({
  href,
  options,
  paidLocked = false,
  forwardSearchParams = [],
  label = "Export",
  size = "sm",
}: DataExportMenuProps) {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<string | null>(null);

  async function download(option: DataExportOption) {
    if (option.paid && paidLocked) {
      toast.error("Upgrade required", {
        description: "Excel and PDF exports are on paid plans. CSV stays free.",
      });
      return;
    }
    setPending(option.label);
    try {
      const params = new URLSearchParams();
      if (!option.omitFormatParam) {
        params.set("format", option.format);
      }
      for (const key of forwardSearchParams) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      if (option.params) {
        for (const [key, value] of Object.entries(option.params)) params.set(key, value);
      }
      const query = params.toString();
      await triggerDownload(query ? `${href}?${query}` : href);
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={pending !== null}>
          {pending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <FileDownIcon className="size-4" />
          )}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option, index) => {
          const locked = Boolean(option.paid && paidLocked);
          const showSeparator = index > 0 && option.format === "zip";
          return (
            <div key={`${option.format}-${option.label}`}>
              {showSeparator ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={locked || pending !== null}
                title={locked ? "Requires a paid plan" : undefined}
                onClick={() => download(option)}
              >
                {option.label}
                {locked ? " (upgrade)" : ""}
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
