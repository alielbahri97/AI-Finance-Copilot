/**
 * Revolut-style interaction feedback for the PWA: soft UI tones via Web Audio
 * and short vibration patterns where the browser allows it (mainly Android).
 *
 * Preferences live in localStorage so they follow the device, not the account.
 */

export type FeedbackKind =
  | "tap"
  | "select"
  | "toggle"
  | "success"
  | "error"
  | "warning"
  | "celebration";

export type FeedbackPreference = "sound" | "haptics";

const STORAGE_KEYS = {
  sound: "ballast.feedback.sound",
  haptics: "ballast.feedback.haptics",
} as const;

const VIBRATE: Record<FeedbackKind, number | number[]> = {
  tap: 8,
  select: 10,
  toggle: 8,
  success: [12, 36, 18],
  error: [36, 28, 36],
  warning: 22,
  celebration: [14, 40, 14, 40, 28],
};

type Tone = { freq: number; duration: number; gain: number; type?: OscillatorType; delay?: number };

const TONES: Record<FeedbackKind, Tone[]> = {
  tap: [{ freq: 920, duration: 0.018, gain: 0.028, type: "sine" }],
  select: [{ freq: 740, duration: 0.022, gain: 0.03, type: "triangle" }],
  toggle: [{ freq: 680, duration: 0.02, gain: 0.026, type: "sine" }],
  success: [
    { freq: 660, duration: 0.05, gain: 0.035, type: "sine" },
    { freq: 880, duration: 0.07, gain: 0.032, type: "sine", delay: 0.055 },
  ],
  error: [
    { freq: 220, duration: 0.08, gain: 0.04, type: "square" },
    { freq: 180, duration: 0.09, gain: 0.032, type: "square", delay: 0.07 },
  ],
  warning: [{ freq: 420, duration: 0.06, gain: 0.034, type: "triangle" }],
  celebration: [
    { freq: 523, duration: 0.06, gain: 0.03, type: "sine" },
    { freq: 659, duration: 0.06, gain: 0.03, type: "sine", delay: 0.07 },
    { freq: 784, duration: 0.1, gain: 0.034, type: "sine", delay: 0.14 },
  ],
};

let audioCtx: AudioContext | null = null;
let lastTapAt = 0;
const TAP_GAP_MS = 28;

type PreferenceListener = () => void;
const listeners = new Set<PreferenceListener>();

function readStored(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "on") return true;
    if (value === "off") return false;
  } catch {
    // private mode / blocked storage
  }
  return null;
}

function writeStored(key: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, enabled ? "on" : "off");
  } catch {
    // ignore
  }
}

export function isSoundEnabled(): boolean {
  const stored = readStored(STORAGE_KEYS.sound);
  return stored ?? true;
}

export function isHapticsEnabled(): boolean {
  const stored = readStored(STORAGE_KEYS.haptics);
  if (stored !== null) return stored;
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setFeedbackPreference(kind: FeedbackPreference, enabled: boolean) {
  writeStored(STORAGE_KEYS[kind], enabled);
  for (const listener of listeners) listener();
}

export function subscribeFeedbackPreferences(listener: PreferenceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTones(tones: Tone[]) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  for (const tone of tones) {
    const start = now + (tone.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.setValueAtTime(tone.freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + tone.duration + 0.02);
  }
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // unsupported / blocked
  }
}

export function feedback(kind: FeedbackKind) {
  if (typeof window === "undefined") return;

  if (kind === "tap" || kind === "select" || kind === "toggle") {
    const now = performance.now();
    if (now - lastTapAt < TAP_GAP_MS) return;
    lastTapAt = now;
  }

  if (isSoundEnabled()) playTones(TONES[kind]);
  if (isHapticsEnabled()) vibrate(VIBRATE[kind]);
}

feedback.tap = () => feedback("tap");
feedback.select = () => feedback("select");
feedback.toggle = () => feedback("toggle");
feedback.success = () => feedback("success");
feedback.error = () => feedback("error");
feedback.warning = () => feedback("warning");
feedback.celebration = () => feedback("celebration");
