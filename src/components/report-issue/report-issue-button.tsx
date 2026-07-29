"use client";

import { useCallback, useMemo, useState } from "react";
import { BugIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildReportIssueBody, openReportIssue, type ReportIssueContext } from "@/lib/report-issue";
import { cn } from "@/lib/utils";

interface ReportIssueButtonProps {
  variant?: "floating" | "inline" | "menu";
  className?: string;
  errorMessage?: string;
  errorDigest?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function ReportIssueButton({
  variant = "floating",
  className,
  errorMessage,
  errorDigest,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: ReportIssueButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [notes, setNotes] = useState("");

  const context = useMemo<ReportIssueContext>(
    () => ({
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      errorMessage,
      errorDigest,
      userNotes: notes,
    }),
    [errorDigest, errorMessage, notes]
  );

  const preview = useMemo(() => buildReportIssueBody(context), [context]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Could not copy report");
    }
  }, [preview]);

  const handleSubmit = useCallback(() => {
    openReportIssue(context);
    setNotes("");
    setOpen(false);
    toast.success("Opening issue report…");
  }, [context, setOpen]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Clear leftover notes when closing so the next report starts blank.
    if (!next) setNotes("");
  }

  const trigger =
    variant === "floating" ? (
      <Button
        size="lg"
        className={cn(
          "fixed right-4 bottom-4 z-50 h-11 gap-2 rounded-full px-4 shadow-lg sm:right-6 sm:bottom-6",
          className
        )}
        aria-label="Report an issue"
      >
        <BugIcon className="size-4" />
        Report issue
      </Button>
    ) : variant === "menu" ? (
      <button
        type="button"
        className={cn(
          "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
          className
        )}
      >
        <BugIcon className="size-4" />
        Report issue
      </button>
    ) : (
      <Button variant="outline" size="sm" className={cn("gap-2", className)}>
        <BugIcon className="size-4" />
        Report issue
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We&apos;ll include the page URL and browser info to help debug.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="issue-notes">What happened?</Label>
            <Textarea
              id="issue-notes"
              placeholder="e.g. Import failed after uploading my CSV…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
            />
          </div>
          {(errorMessage || errorDigest) && (
            <div className="bg-muted rounded-md p-3 text-xs">
              {errorMessage ? <p className="font-medium">{errorMessage}</p> : null}
              {errorDigest ? (
                <p className="text-muted-foreground mt-1">Reference: {errorDigest}</p>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={handleCopy}>
            <CopyIcon className="size-4" />
            Copy details
          </Button>
          <Button type="button" onClick={handleSubmit}>
            <ExternalLinkIcon className="size-4" />
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
