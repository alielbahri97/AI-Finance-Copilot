import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("feedback preferences", () => {
  const store: Record<string, string> = {};
  const vibrate = vi.fn(() => true);
  let reducedMotion = false;

  beforeEach(async () => {
    Object.keys(store).forEach((key) => delete store[key]);
    vibrate.mockClear();
    reducedMotion = false;

    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
      matchMedia: (query: string) => ({
        matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      AudioContext: undefined,
      performance: { now: () => Date.now() },
    });
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("performance", { now: () => Date.now() });

    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function load() {
    return import("@/lib/feedback");
  }

  it("defaults sound on and haptics on when motion is allowed", async () => {
    const { isSoundEnabled, isHapticsEnabled } = await load();
    expect(isSoundEnabled()).toBe(true);
    expect(isHapticsEnabled()).toBe(true);
  });

  it("defaults haptics off when the user prefers reduced motion", async () => {
    reducedMotion = true;
    const { isHapticsEnabled } = await load();
    expect(isHapticsEnabled()).toBe(false);
  });

  it("persists explicit preference overrides", async () => {
    const { isSoundEnabled, isHapticsEnabled, setFeedbackPreference } = await load();
    setFeedbackPreference("sound", false);
    setFeedbackPreference("haptics", false);
    expect(isSoundEnabled()).toBe(false);
    expect(isHapticsEnabled()).toBe(false);

    setFeedbackPreference("sound", true);
    setFeedbackPreference("haptics", true);
    expect(isSoundEnabled()).toBe(true);
    expect(isHapticsEnabled()).toBe(true);
  });

  it("vibrates for tap when haptics are enabled", async () => {
    const { feedback } = await load();
    feedback.tap();
    expect(vibrate).toHaveBeenCalledWith(4);
  });

  it("skips vibration when haptics are disabled", async () => {
    const { feedback, setFeedbackPreference } = await load();
    setFeedbackPreference("haptics", false);
    feedback.tap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("respects prefs updated before the feedback call in the same turn", async () => {
    const { feedback, setFeedbackPreference } = await load();
    setFeedbackPreference("haptics", false);
    // Mirrors Switch calling the consumer first, then feedback.toggle().
    feedback.toggle();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
