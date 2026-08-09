"use client";

import { SessionLockProvider } from "@/components/auth/session-lock-provider";

/**
 * Local-only harness to exercise the soft session lock without signing in.
 * Gated in the server wrapper at `page.tsx` — this file is the client island.
 */
export function SessionLockTestClient() {
  return (
    <SessionLockProvider email="lock-test@ballast.local" userId="session-lock-test-user">
      <main id="main-content" className="mx-auto flex min-h-svh max-w-lg flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Session lock test</h1>
        <p className="text-muted-foreground text-sm">
          Switch to another tab or app for 10+ seconds, then come back. You should see the
          lock screen. Password unlock will fail here (fake user) — use the timer + overlay
          check only.
        </p>
        <p data-testid="session-lock-open-content">Authenticated content is visible.</p>
      </main>
    </SessionLockProvider>
  );
}
