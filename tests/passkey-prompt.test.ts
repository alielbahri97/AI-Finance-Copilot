import { describe, expect, it } from "vitest";

import {
  decidePasskeyPrompt,
  PASSKEY_PROMPT_COOLDOWN_MS,
  PASSKEY_PROMPT_DISMISSED_AT_KEY,
  PASSKEY_PROMPT_NEVER_KEY,
  PASSKEY_PROMPT_OCCASIONAL_RATE,
  readPasskeyPromptPrefs,
  writePasskeyPromptDismissed,
  writePasskeyPromptNever,
} from "@/lib/auth/passkey-prompt";

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

describe("decidePasskeyPrompt", () => {
  const base = {
    webAuthnAvailable: true,
    passkeyCount: 0,
    prefs: { never: false, dismissedAt: null as number | null },
    now: 1_000_000,
    random: 0,
  };

  it("shows on the first opportunity when WebAuthn works and there are no passkeys", () => {
    expect(decidePasskeyPrompt(base)).toEqual({ show: true, reason: "first" });
  });

  it("hides when WebAuthn is unavailable", () => {
    expect(decidePasskeyPrompt({ ...base, webAuthnAvailable: false })).toEqual({ show: false });
  });

  it("hides when the account already has passkeys", () => {
    expect(decidePasskeyPrompt({ ...base, passkeyCount: 1 })).toEqual({ show: false });
  });

  it("hides when the user opted out", () => {
    expect(
      decidePasskeyPrompt({ ...base, prefs: { never: true, dismissedAt: null } })
    ).toEqual({ show: false });
  });

  it("hides during the cooldown after a soft dismiss", () => {
    expect(
      decidePasskeyPrompt({
        ...base,
        prefs: { never: false, dismissedAt: base.now - PASSKEY_PROMPT_COOLDOWN_MS + 1 },
        random: 0,
      })
    ).toEqual({ show: false });
  });

  it("occasionally re-prompts after the cooldown", () => {
    const afterCooldown = base.now - PASSKEY_PROMPT_COOLDOWN_MS - 1;
    expect(
      decidePasskeyPrompt({
        ...base,
        prefs: { never: false, dismissedAt: afterCooldown },
        random: PASSKEY_PROMPT_OCCASIONAL_RATE - 0.001,
      })
    ).toEqual({ show: true, reason: "occasional" });

    expect(
      decidePasskeyPrompt({
        ...base,
        prefs: { never: false, dismissedAt: afterCooldown },
        random: PASSKEY_PROMPT_OCCASIONAL_RATE,
      })
    ).toEqual({ show: false });
  });
});

describe("passkey prompt localStorage helpers", () => {
  it("reads and writes dismissedAt / never prefs", () => {
    const storage = memoryStorage();
    expect(readPasskeyPromptPrefs(storage)).toEqual({ never: false, dismissedAt: null });

    writePasskeyPromptDismissed(42, storage);
    expect(storage.getItem(PASSKEY_PROMPT_DISMISSED_AT_KEY)).toBe("42");
    expect(readPasskeyPromptPrefs(storage)).toEqual({ never: false, dismissedAt: 42 });

    writePasskeyPromptNever(storage);
    expect(storage.getItem(PASSKEY_PROMPT_NEVER_KEY)).toBe("1");
    expect(readPasskeyPromptPrefs(storage)).toEqual({ never: true, dismissedAt: 42 });
  });

  it("treats invalid dismissedAt as unset", () => {
    const storage = memoryStorage({ [PASSKEY_PROMPT_DISMISSED_AT_KEY]: "nope" });
    expect(readPasskeyPromptPrefs(storage)).toEqual({ never: false, dismissedAt: null });
  });
});
