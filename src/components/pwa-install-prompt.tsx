"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BRAND, BRAND_SLUG } from "@/lib/branding";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Durable dismiss flag — refresh must not bring the prompt back. */
const DISMISS_KEY = `${BRAND_SLUG}-pwa-install-dismissed`;

/** Keep dismissal for at least 90 days (effectively permanent for most users). */
const DISMISS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    // Legacy boolean flag from earlier builds.
    if (raw === "1" || raw === "true") return true;
    const dismissedAt = Date.parse(raw);
    if (Number.isNaN(dismissedAt)) return true;
    return Date.now() - dismissedAt < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
  } catch {
    // Private mode / blocked storage — still hide for this page load via state.
  }
}

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari when launched from the home screen.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * Lightweight Install App prompt for Chromium (Android / desktop Windows/Edge).
 * iOS users use Share → Add to Home Screen (no beforeinstallprompt).
 *
 * Mount only in the authenticated dashboard shell — not on marketing/login.
 */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneDisplay()) return;
    if (readDismissed()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      // Re-check in case dismiss landed between listener attach and event.
      if (readDismissed() || isStandaloneDisplay()) return;
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || !deferred) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
    // Persist either outcome so refresh does not re-prompt after they engaged.
    writeDismissed();
  }

  function dismiss() {
    writeDismissed();
    setDeferred(null);
    setVisible(false);
  }

  return (
    <div
      role="status"
      // Sits one step above the help FAB in the same corner, so the two never
      // land on each other and neither one covers the mobile tab bar.
      className="border-border bg-background/95 fixed inset-x-3 bottom-[calc(var(--tab-bar-height)+4.75rem)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border p-3 shadow-lg backdrop-blur sm:inset-x-auto sm:right-6 sm:left-auto"
    >
      <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
        <DownloadIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install {BRAND.name}</p>
        <p className="text-muted-foreground text-xs">Add the app to your home screen or Start menu.</p>
      </div>
      <Button size="sm" onClick={() => void install()}>
        Install
      </Button>
      <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={dismiss} aria-label="Dismiss">
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
