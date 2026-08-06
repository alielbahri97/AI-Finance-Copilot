"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BRAND, BRAND_SLUG } from "@/lib/branding";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = `${BRAND_SLUG}-pwa-install-dismissed`;

/**
 * Lightweight Install App prompt for Chromium (Android / desktop Windows/Edge).
 * iOS users use Share → Add to Home Screen (no beforeinstallprompt).
 */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
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
    const choice = await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
    if (choice.outcome === "dismissed") {
      localStorage.setItem(DISMISS_KEY, "1");
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
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
