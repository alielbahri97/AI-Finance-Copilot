/**
 * Soft fintech-style interaction feedback (Revolut-inspired, not their assets):
 * filtered synth ticks, confirmation chimes, and short vibration where allowed.
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
  tap: 2,
  select: 3,
  toggle: 2,
  success: [3, 9, 5],
  error: [9, 7, 9],
  warning: 6,
  celebration: [4, 10, 4, 10, 7],
};

/**
 * Voice recipes tuned toward Revolut's soft modern banking palette:
 * rounded sine/triangle blend, short envelopes, no harsh square buzzes.
 */
type Voice = {
  freqs: number[];
  duration: number;
  gain: number;
  delay?: number;
  /** Mix a second quieter partial for a soft synth body. */
  partial?: number;
  /** Optional downward glide in Hz over the note (errors). */
  glide?: number;
  /** Blended high-frequency tick (buttons / toggles). */
  click?: boolean;
};

const VOICES: Record<FeedbackKind, Voice[]> = {
  // Soft mechanical tick — barely there, like a premium app press.
  tap: [{ freqs: [1850], duration: 0.028, gain: 0.018, click: true }],
  select: [{ freqs: [1480], duration: 0.032, gain: 0.02, click: true }],
  toggle: [{ freqs: [1320, 1980], duration: 0.034, gain: 0.018, click: true }],
  // Soft ascending confirmation — “payment went through”.
  success: [
    { freqs: [587], duration: 0.07, gain: 0.028, partial: 2 },
    { freqs: [784], duration: 0.11, gain: 0.03, delay: 0.06, partial: 2 },
  ],
  // Soft descending resolve — no buzzy square wave.
  error: [
    { freqs: [320], duration: 0.1, gain: 0.03, glide: -70, partial: 1.5 },
    { freqs: [240], duration: 0.12, gain: 0.024, delay: 0.08, glide: -40, partial: 1.5 },
  ],
  warning: [{ freqs: [440], duration: 0.08, gain: 0.026, partial: 2 }],
  // Three-note modern motif + soft resolve (audio-logo adjacent, original).
  celebration: [
    { freqs: [523], duration: 0.08, gain: 0.026, partial: 2 },
    { freqs: [659], duration: 0.08, gain: 0.026, delay: 0.09, partial: 2 },
    { freqs: [784], duration: 0.14, gain: 0.032, delay: 0.18, partial: 2 },
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

function playVoice(ctx: AudioContext, voice: Voice, when: number) {
  const start = when + (voice.delay ?? 0);
  const end = start + voice.duration;

  const master = ctx.createGain();
  // Soft low-pass keeps the palette round — closer to polished banking UI than raw oscillators.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(voice.click ? 4200 : 2800, start);
  filter.Q.setValueAtTime(0.7, start);

  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(voice.gain, start + 0.006);
  master.gain.exponentialRampToValueAtTime(voice.gain * 0.55, start + voice.duration * 0.35);
  master.gain.exponentialRampToValueAtTime(0.0001, end);

  filter.connect(master);
  master.connect(ctx.destination);

  for (const freq of voice.freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (voice.glide) {
      osc.frequency.linearRampToValueAtTime(Math.max(40, freq + voice.glide), end);
    }
    osc.connect(filter);
    osc.start(start);
    osc.stop(end + 0.02);

    if (voice.partial) {
      const partial = ctx.createOscillator();
      const partialGain = ctx.createGain();
      partial.type = "triangle";
      partial.frequency.setValueAtTime(freq * voice.partial, start);
      if (voice.glide) {
        partial.frequency.linearRampToValueAtTime(
          Math.max(40, (freq + voice.glide) * voice.partial),
          end
        );
      }
      partialGain.gain.setValueAtTime(voice.gain * 0.22, start);
      partial.connect(partialGain);
      partialGain.connect(filter);
      partial.start(start);
      partial.stop(end + 0.02);
    }
  }

  if (voice.click) {
    // Tiny filtered noise burst — the soft “tick” body of a Revolut-like press.
    const duration = Math.min(0.02, voice.duration);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2400, start);
    noiseFilter.Q.setValueAtTime(1.2, start);
    noiseGain.gain.setValueAtTime(voice.gain * 0.7, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(start);
    noise.stop(start + duration + 0.01);
  }
}

function playVoices(voices: Voice[]) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const voice of voices) playVoice(ctx, voice, now);
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

  if (isSoundEnabled()) playVoices(VOICES[kind]);
  if (isHapticsEnabled()) vibrate(VIBRATE[kind]);
}

feedback.tap = () => feedback("tap");
feedback.select = () => feedback("select");
feedback.toggle = () => feedback("toggle");
feedback.success = () => feedback("success");
feedback.error = () => feedback("error");
feedback.warning = () => feedback("warning");
feedback.celebration = () => feedback("celebration");
