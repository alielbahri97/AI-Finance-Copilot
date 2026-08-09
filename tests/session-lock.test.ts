import { describe, expect, it } from "vitest";

import {
  SESSION_LOCK_AFTER_MS,
  SESSION_LOCK_FLAG_KEY,
  SESSION_LOCK_HIDDEN_AT_KEY,
  clearSessionLock,
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
});
