"use client";

import { useEffect } from "react";

/**
 * Registers the Ballast service worker for installability (PWA) and Web Push.
 * Safe to mount on every page; browsers no-op when already registered.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;

    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability still works from the manifest; push registration happens in Settings.
    });
  }, []);

  return null;
}
