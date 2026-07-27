import { describe, expect, it } from "vitest";

import { TokenBucketLimiter } from "@/lib/rate-limit";

function limiterAt(startMs = 0) {
  let now = startMs;
  const limiter = new TokenBucketLimiter(() => now);
  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
  };
}

const CONFIG = { limit: 5, windowMs: 60_000 };

describe("token bucket rate limiter", () => {
  it("allows up to the limit in a burst, then blocks", () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user:a", CONFIG).allowed).toBe(true);
    }
    const blocked = limiter.check("user:a", CONFIG);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills continuously over the window", () => {
    const { limiter, advance } = limiterAt();
    for (let i = 0; i < 5; i++) limiter.check("user:a", CONFIG);
    expect(limiter.check("user:a", CONFIG).allowed).toBe(false);

    // One token refills every windowMs / limit = 12s.
    advance(12_000);
    expect(limiter.check("user:a", CONFIG).allowed).toBe(true);
    expect(limiter.check("user:a", CONFIG).allowed).toBe(false);
  });

  it("never exceeds the burst capacity after a long idle period", () => {
    const { limiter, advance } = limiterAt();
    limiter.check("user:a", CONFIG);
    advance(3_600_000);
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (limiter.check("user:a", CONFIG).allowed) allowed++;
    }
    expect(allowed).toBe(5);
  });

  it("isolates keys from each other", () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < 5; i++) limiter.check("user:a", CONFIG);
    expect(limiter.check("user:a", CONFIG).allowed).toBe(false);
    expect(limiter.check("user:b", CONFIG).allowed).toBe(true);
  });
});
