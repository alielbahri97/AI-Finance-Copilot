"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ExpandIcon, HelpCircleIcon, Loader2Icon } from "lucide-react";

import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { HelpChat, type HelpMessageItem } from "./help-chat";

/**
 * Floating help button on every dashboard page. Opens a compact chat panel;
 * the full experience lives on /help. Distinct from the finance copilot —
 * this answers "how do I use the app" questions.
 */
export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessageItem[] | null>(null);
  const loadingRef = useRef(false);

  const loadHistory = useCallback(async () => {
    if (loadingRef.current || messages !== null) return;
    loadingRef.current = true;
    try {
      const response = await fetch("/api/help");
      const body = (await response.json()) as { messages?: HelpMessageItem[] };
      setMessages(response.ok ? (body.messages ?? []) : []);
    } catch {
      setMessages([]);
    } finally {
      loadingRef.current = false;
    }
  }, [messages]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void loadHistory();
  };

  return (
    <>
      <Button
        size="icon"
        onClick={() => handleOpenChange(true)}
        aria-label="Help & support"
        title="Help & support"
        className="fixed right-4 bottom-4 z-40 size-11 rounded-full shadow-lg sm:right-6 sm:bottom-6"
      >
        <HelpCircleIcon className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <div className="flex items-center justify-between gap-2">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <HelpCircleIcon className="size-4" />
                  Help & support
                </SheetTitle>
                <SheetDescription>
                  How-to questions about the app. For questions about your numbers, use the{" "}
                  <Link href="/copilot" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                    Copilot
                  </Link>
                  .
                </SheetDescription>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label="Open full help page">
                <Link href="/help" onClick={() => setOpen(false)}>
                  <ExpandIcon className="size-4" />
                </Link>
              </Button>
            </div>
          </SheetHeader>

          {messages === null ? (
            <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <HelpChat initialMessages={messages} compact className="min-h-0 flex-1" />
          )}

          <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
            <span>Something broken?</span>
            <ReportIssueButton variant="inline" className="h-7 px-2 text-xs" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
