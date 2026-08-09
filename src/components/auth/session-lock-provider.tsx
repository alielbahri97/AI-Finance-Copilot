"use client";

import { useCallback, useEffect, useState } from "react";

import { SessionLockScreen } from "@/components/auth/session-lock-screen";
import {
  clearSessionLock,
  readSessionLockFlag,
  readSessionLockHiddenAt,
  shouldLockAfterHidden,
  writeSessionLockFlag,
  writeSessionLockHiddenAt,
} from "@/lib/auth/session-lock";

type SessionLockProviderProps = {
  email: string;
  userId: string;
  children: React.ReactNode;
};

/**
 * Locks authenticated UI after the tab/PWA is backgrounded for ~10s.
 * Soft lock: Supabase cookies remain; passkey or password unlocks the screen.
 */
export function SessionLockProvider({ email, userId, children }: SessionLockProviderProps) {
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);

  const lock = useCallback(() => {
    writeSessionLockFlag(true);
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    clearSessionLock();
    setLocked(false);
  }, []);

  // Restore lock across refresh, or if the tab was discarded while backgrounded.
  useEffect(() => {
    const now = Date.now();
    if (
      readSessionLockFlag() ||
      shouldLockAfterHidden({ hiddenAt: readSessionLockHiddenAt(), now })
    ) {
      writeSessionLockFlag(true);
      setLocked(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    let hiddenAt: number | null = readSessionLockHiddenAt();

    const markHidden = () => {
      if (locked) return;
      hiddenAt = Date.now();
      writeSessionLockHiddenAt(hiddenAt);
    };

    const maybeLockOnVisible = () => {
      if (locked) return;
      const now = Date.now();
      const awaySince = hiddenAt ?? readSessionLockHiddenAt();
      if (shouldLockAfterHidden({ hiddenAt: awaySince, now })) {
        lock();
      } else {
        // Short absence — drop the marker so a later refresh does not lock.
        hiddenAt = null;
        clearSessionLock();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markHidden();
      } else {
        maybeLockOnVisible();
      }
    };

    const onPageHide = () => {
      markHidden();
    };
    const onPageShow = () => {
      maybeLockOnVisible();
    };

    if (document.visibilityState === "hidden") {
      markHidden();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [ready, locked, lock]);

  return (
    <>
      <div inert={locked ? true : undefined} aria-hidden={locked || undefined}>
        {children}
      </div>
      {locked ? (
        <SessionLockScreen email={email} userId={userId} onUnlocked={unlock} />
      ) : null}
    </>
  );
}
