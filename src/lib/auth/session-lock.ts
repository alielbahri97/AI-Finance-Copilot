/**
 * Soft session lock (Revolut-style): after the tab/app is hidden long enough,
 * the UI requires passkey or password before showing authenticated content again.
 *
 * The Supabase session cookie stays intact — this is an app lock, not a full
 * sign-out. State lives in sessionStorage so a refresh while locked stays locked.
 */

export const SESSION_LOCK_AFTER_MS = 10_000;

export const SESSION_LOCK_FLAG_KEY = "ballast.sessionLock.locked";
export const SESSION_LOCK_HIDDEN_AT_KEY = "ballast.sessionLock.hiddenAt";

export type SessionLockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): SessionLockStorage | null {
  return typeof window !== "undefined" ? window.sessionStorage : null;
}

/** True when the user has been away (hidden) for at least `thresholdMs`. */
export function shouldLockAfterHidden(input: {
  hiddenAt: number | null;
  now: number;
  thresholdMs?: number;
}): boolean {
  const { hiddenAt, now, thresholdMs = SESSION_LOCK_AFTER_MS } = input;
  if (hiddenAt == null || !Number.isFinite(hiddenAt) || hiddenAt <= 0) return false;
  if (!Number.isFinite(now)) return false;
  return now - hiddenAt >= thresholdMs;
}

export function readSessionLockFlag(
  storage: SessionLockStorage | null = defaultStorage()
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SESSION_LOCK_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSessionLockFlag(
  locked: boolean,
  storage: SessionLockStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    if (locked) {
      storage.setItem(SESSION_LOCK_FLAG_KEY, "1");
    } else {
      storage.removeItem(SESSION_LOCK_FLAG_KEY);
      storage.removeItem(SESSION_LOCK_HIDDEN_AT_KEY);
    }
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

export function writeSessionLockHiddenAt(
  hiddenAt: number,
  storage: SessionLockStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_LOCK_HIDDEN_AT_KEY, String(hiddenAt));
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

export function readSessionLockHiddenAt(
  storage: SessionLockStorage | null = defaultStorage()
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_LOCK_HIDDEN_AT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Clears lock flag and hidden timestamp (call after unlock or full sign-out). */
export function clearSessionLock(storage: SessionLockStorage | null = defaultStorage()): void {
  writeSessionLockFlag(false, storage);
}
