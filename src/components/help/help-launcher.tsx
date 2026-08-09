"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { DEFAULT_EDITION, type Edition } from "@/lib/branding";

import { HelpChat, type HelpMessageItem } from "./help-chat";

/**
 * Routes whose primary UI already owns the bottom-right corner (chat Send /
 * Stop, suggestion chips). The FAB is omitted there so it never covers those
 * controls — Help stays reachable from the sidebar and the /help page itself.
 */
const HIDE_FAB_PREFIXES = ["/copilot", "/help"] as const;

function shouldHideHelpFab(pathname: string | null): boolean {
  if (!pathname) return false;
  return HIDE_FAB_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Floating help button on every dashboard page. Opens a compact chat panel;
 * the full experience lives on /help. Distinct from the finance copilot —
 * this answers "how do I use the app" questions.
 */
export function HelpLauncher({ edition = DEFAULT_EDITION }: { edition?: Edition }) {
  const pathname = usePathname();
  const hideFab = shouldHideHelpFab(pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessageItem[] | null>(null);
  const loadingRef = useRef(false);

  // Leave the floating panel closed when landing on a composer route — the FAB
  // is hidden there and an open sheet would fight the page's own Send control.
  useEffect(() => {
    if (hideFab) setOpen(false);
  }, [hideFab]);

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
      {!hideFab && !open && (
        <Button
          size="icon"
          onClick={() => handleOpenChange(true)}
          aria-label="Help & support"
          title="Help & support"
          // Bottom-right, above the tab bar at every width. Toasts have moved to
          // the top, so this corner is now the one place floating utilities live
          // — with the install prompt stacked directly above it. Omitted on
          // chat composers (and while the panel is open) so it never covers
          // Send / Stop or suggestion chips.
          className="fixed right-4 bottom-[calc(var(--tab-bar-height)+1.5rem)] z-40 size-11 rounded-full shadow-lg sm:right-6"
        >
          <HelpCircleIcon className="size-5" />
        </Button>
      )}

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
            <HelpChat
              initialMessages={messages}
              edition={edition}
              compact
              className="min-h-0 flex-1"
            />
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
