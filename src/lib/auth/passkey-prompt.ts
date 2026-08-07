/**
 * localStorage prefs + pure decision logic for the post-login passkey setup prompt.
 *
 * Keys match the product convention (`ballast.*`). Nothing sensitive is stored —
 * only whether the user opted out and when they last dismissed the nudge.
 */

export const PASSKEY_PROMPT_DISMISSED_AT_KEY = "ballast.passkeyPrompt.dismissedAt";
export const PASSKEY_PROMPT_NEVER_KEY = "ballast.passkeyPrompt.never";

/** Minimum gap between a "Not now" dismiss and another occasional nudge. */
export const PASSKEY_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Chance to re-prompt after the cooldown (dashboard load / session check). */
export const PASSKEY_PROMPT_OCCASIONAL_RATE = 0.15;

export type PasskeyPromptPrefs = {
  never: boolean;
  /** Epoch ms of the last soft dismiss, or null if never dismissed. */
  dismissedAt: number | null;
};

export type PasskeyPromptDecision =
  | { show: false }
  | { show: true; reason: "first" | "occasional" };

export function readPasskeyPromptPrefs(
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null
): PasskeyPromptPrefs {
  if (!storage) return { never: false, dismissedAt: null };
  try {
    const never = storage.getItem(PASSKEY_PROMPT_NEVER_KEY) === "1";
    const raw = storage.getItem(PASSKEY_PROMPT_DISMISSED_AT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    const dismissedAt = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    return { never, dismissedAt };
  } catch {
    return { never: false, dismissedAt: null };
  }
}

export function writePasskeyPromptDismissed(
  at: number,
  storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null
): void {
  if (!storage) return;
  try {
    storage.setItem(PASSKEY_PROMPT_DISMISSED_AT_KEY, String(at));
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

export function writePasskeyPromptNever(
  storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null
): void {
  if (!storage) return;
  try {
    storage.setItem(PASSKEY_PROMPT_NEVER_KEY, "1");
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

/**
 * Decide whether to show the passkey setup nudge.
 *
 * - First opportunity (never dismissed): always show when WebAuthn works and
 *   the account has zero passkeys.
 * - Later: after the cooldown, show with OCCASIONAL_RATE probability.
 * - Never nag when opted out, passkeys exist, or WebAuthn is unavailable.
 */
export function decidePasskeyPrompt(input: {
  webAuthnAvailable: boolean;
  passkeyCount: number;
  prefs: PasskeyPromptPrefs;
  now: number;
  random: number;
  cooldownMs?: number;
  occasionalRate?: number;
}): PasskeyPromptDecision {
  const {
    webAuthnAvailable,
    passkeyCount,
    prefs,
    now,
    random,
    cooldownMs = PASSKEY_PROMPT_COOLDOWN_MS,
    occasionalRate = PASSKEY_PROMPT_OCCASIONAL_RATE,
  } = input;

  if (!webAuthnAvailable) return { show: false };
  if (passkeyCount > 0) return { show: false };
  if (prefs.never) return { show: false };

  if (prefs.dismissedAt == null) {
    return { show: true, reason: "first" };
  }

  if (now - prefs.dismissedAt < cooldownMs) {
    return { show: false };
  }

  if (random >= 0 && random < occasionalRate) {
    return { show: true, reason: "occasional" };
  }

  return { show: false };
}
