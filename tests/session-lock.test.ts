import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_LOCK_AFTER_MS,
  SESSION_LOCK_FLAG_KEY,
  SESSION_LOCK_HIDDEN_AT_KEY,
  clearSessionLock,
  clearSessionLockHiddenAt,
  msUntilSessionLock,
  readSessionLockFlag,
  readSessionLockHiddenAt,
  shouldLockAfterHidden,
  writeSessionLockFlag,
  writeSessionLockHiddenAt,
} from "@/lib/auth/session-lock";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("shouldLockAfterHidden", () => {
  const hiddenAt = 1_000_000;

  it("does not lock when never hidden", () => {
    expect(shouldLockAfterHidden({ hiddenAt: null, now: hiddenAt + 60_000 })).toBe(false);
  });

  it("does not lock before the threshold", () => {
    expect(
      shouldLockAfterHidden({
        hiddenAt,
        now: hiddenAt + SESSION_LOCK_AFTER_MS - 1,
      })
    ).toBe(false);
  });

  it("locks at and after the threshold", () => {
    expect(
      shouldLockAfterHidden({
        hiddenAt,
        now: hiddenAt + SESSION_LOCK_AFTER_MS,
      })
    ).toBe(true);
    expect(
      shouldLockAfterHidden({
        hiddenAt,
        now: hiddenAt + SESSION_LOCK_AFTER_MS + 5_000,
      })
    ).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(shouldLockAfterHidden({ hiddenAt: 0, now: 10_000 })).toBe(false);
    expect(shouldLockAfterHidden({ hiddenAt: NaN, now: 10_000 })).toBe(false);
    expect(shouldLockAfterHidden({ hiddenAt: 1, now: NaN })).toBe(false);
  });
});

describe("msUntilSessionLock", () => {
  const hiddenAt = 1_000_000;

  it("returns null when inactive timestamp is missing", () => {
    expect(msUntilSessionLock({ hiddenAt: null, now: hiddenAt })).toBeNull();
  });

  it("returns remaining ms before the threshold", () => {
    expect(
      msUntilSessionLock({
        hiddenAt,
        now: hiddenAt + 2_500,
      })
    ).toBe(SESSION_LOCK_AFTER_MS - 2_500);
  });

  it("returns 0 once the threshold has passed", () => {
    expect(
      msUntilSessionLock({
        hiddenAt,
        now: hiddenAt + SESSION_LOCK_AFTER_MS + 100,
      })
    ).toBe(0);
  });
});

describe("session lock storage helpers", () => {
  it("persists and clears the locked flag", () => {
    const storage = memoryStorage();
    expect(readSessionLockFlag(storage)).toBe(false);

    writeSessionLockFlag(true, storage);
    expect(storage.getItem(SESSION_LOCK_FLAG_KEY)).toBe("1");
    expect(readSessionLockFlag(storage)).toBe(true);

    writeSessionLockHiddenAt(42, storage);
    expect(readSessionLockHiddenAt(storage)).toBe(42);

    clearSessionLock(storage);
    expect(readSessionLockFlag(storage)).toBe(false);
    expect(storage.getItem(SESSION_LOCK_FLAG_KEY)).toBeNull();
    expect(storage.getItem(SESSION_LOCK_HIDDEN_AT_KEY)).toBeNull();
  });

  it("can clear only the hidden timestamp while keeping the lock flag", () => {
    const storage = memoryStorage();
    writeSessionLockFlag(true, storage);
    writeSessionLockHiddenAt(99, storage);

    clearSessionLockHiddenAt(storage);

    expect(readSessionLockFlag(storage)).toBe(true);
    expect(readSessionLockHiddenAt(storage)).toBeNull();
  });
});

describe("inactivity arm/resolve timing (simulated)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("engages after the threshold while still inactive", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const start = 5_000_000;
    vi.setSystemTime(start);

    writeSessionLockHiddenAt(start, storage);
    const wait = msUntilSessionLock({
      hiddenAt: readSessionLockHiddenAt(storage),
      now: Date.now(),
    });
    expect(wait).toBe(SESSION_LOCK_AFTER_MS);

    let locked = false;
    const timer = setTimeout(() => {
      writeSessionLockFlag(true, storage);
      locked = true;
    }, wait!);

    vi.advanceTimersByTime(SESSION_LOCK_AFTER_MS - 1);
    expect(locked).toBe(false);

    vi.advanceTimersByTime(1);
    expect(locked).toBe(true);
    expect(readSessionLockFlag(storage)).toBe(true);
    clearTimeout(timer);
  });
});
