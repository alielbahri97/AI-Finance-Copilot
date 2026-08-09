"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SessionLockScreen } from "@/components/auth/session-lock-screen";
import {
  SESSION_LOCK_AFTER_MS,
  clearSessionLock,
  clearSessionLockHiddenAt,
  msUntilSessionLock,
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
 * Locks authenticated UI after the tab/PWA (or window) is inactive for ~10s.
 * Soft lock: Supabase cookies remain; passkey or password unlocks the screen.
 *
 * Uses refs + a timer so we arm while the app is away (not only on return), and
 * so React re-renders do not tear down listeners mid-away.
 */
export function SessionLockProvider({ email, userId, children }: SessionLockProviderProps) {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const inactiveAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootAtRef = useRef(Date.now());

  const engageLock = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    writeSessionLockFlag(true);
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
    inactiveAtRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearSessionLock();
    setLocked(false);
  }, []);

  const clearArmTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armInactivity = useCallback(() => {
    if (lockedRef.current) return;

    const now = Date.now();
    // Ignore blur during the first moments after mount (hydration / focus settle),
    // but still arm immediately when the tab is actually hidden.
    if (
      document.visibilityState !== "hidden" &&
      now - bootAtRef.current < 400
    ) {
      return;
    }

    if (inactiveAtRef.current == null) {
      inactiveAtRef.current = now;
      writeSessionLockHiddenAt(now);
    }

    clearArmTimer();
    const wait = msUntilSessionLock({
      hiddenAt: inactiveAtRef.current,
      now,
      thresholdMs: SESSION_LOCK_AFTER_MS,
    });
    if (wait == null) return;
    if (wait === 0) {
      engageLock();
      return;
    }
    timerRef.current = setTimeout(() => {
      engageLock();
    }, wait);
  }, [clearArmTimer, engageLock]);

  const resolveInactivity = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    clearArmTimer();

    if (lockedRef.current) return;

    const now = Date.now();
    const awaySince = inactiveAtRef.current ?? readSessionLockHiddenAt();
    if (shouldLockAfterHidden({ hiddenAt: awaySince, now })) {
      engageLock();
      return;
    }

    // Short absence — drop the marker so a later refresh does not lock.
    inactiveAtRef.current = null;
    clearSessionLockHiddenAt();
  }, [clearArmTimer, engageLock]);

  // Restore lock across refresh, or if the tab was discarded while backgrounded.
  useEffect(() => {
    const now = Date.now();
    if (
      readSessionLockFlag() ||
      shouldLockAfterHidden({ hiddenAt: readSessionLockHiddenAt(), now })
    ) {
      lockedRef.current = true;
      writeSessionLockFlag(true);
      setLocked(true);
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        armInactivity();
      } else {
        resolveInactivity();
      }
    };

    // Switching to another app often blurs the window without hiding the tab
    // (especially with multiple monitors / visible browser windows).
    const onWindowBlur = () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        blurTimerRef.current = null;
        if (lockedRef.current) return;
        if (!document.hasFocus() || document.visibilityState === "hidden") {
          armInactivity();
        }
      }, 50);
    };

    const onWindowFocus = () => {
      // Focus alone is not enough if the tab is still hidden.
      if (document.visibilityState === "visible" && document.hasFocus()) {
        resolveInactivity();
      }
    };

    const onPageHide = () => {
      armInactivity();
    };

    const onPageShow = () => {
      if (document.visibilityState === "visible") {
        resolveInactivity();
      }
    };

    if (document.visibilityState === "hidden") {
      armInactivity();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      clearArmTimer();
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    };
  }, [armInactivity, resolveInactivity, clearArmTimer]);

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
