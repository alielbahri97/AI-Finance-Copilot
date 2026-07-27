"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadIcon, FileWarningIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DocumentPreviewProps {
  invoiceId: string;
  fileName: string;
}

/**
 * Loads a short-lived signed URL for the stored document and renders it
 * inline (image or embedded PDF) with a download action.
 */
export function DocumentPreview({ invoiceId, fileName }: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/document`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.url) {
        setState("error");
        return;
      }
      setUrl(body.url);
      setMimeType(body.mimeType ?? "");
      setState("ready");
    } catch {
      setState("error");
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") {
    return (
      <div className="text-muted-foreground flex h-80 flex-col items-center justify-center gap-2 rounded-lg border text-sm">
        <Loader2Icon className="size-5 animate-spin" />
        Loading document…
      </div>
    );
  }

  if (state === "error" || !url) {
    return (
      <div className="text-muted-foreground flex h-80 flex-col items-center justify-center gap-3 rounded-lg border text-center text-sm">
        <FileWarningIcon className="size-6 opacity-60" />
        <p className="max-w-60">
          Could not load the document preview. Check the Supabase storage setup (README).
        </p>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCwIcon />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {mimeType === "application/pdf" ? (
        <iframe
          src={url}
          title={fileName}
          className="bg-muted h-[32rem] w-full rounded-lg border"
        />
      ) : (
        // Signed URLs are short-lived and dynamic; next/image can't optimize them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileName}
          className="bg-muted max-h-[32rem] w-full rounded-lg border object-contain"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground truncate text-xs">{fileName}</p>
        <Button size="sm" variant="outline" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" download={fileName}>
            <DownloadIcon />
            Download
          </a>
        </Button>
      </div>
    </div>
  );
}
