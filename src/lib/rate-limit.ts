/**
 * Rate limiting for sensitive/expensive endpoints.
 *
 * Default backend is an in-process token bucket: zero dependencies and fine
 * for a single instance (one Vercel region / one container). Multi-instance
 * deployments should set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN,
 * which switches to a fixed-window counter in Upstash Redis so all instances
 * share the same limits.
 */

export interface RateLimitConfig {
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/** Pure token bucket, exported for tests. Refills continuously. */
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, config: RateLimitConfig): RateLimitResult {
    const timestamp = this.now();
    this.sweep(timestamp, config.windowMs);

    const refillPerMs = config.limit / config.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: config.limit, lastRefill: timestamp };
    bucket.tokens = Math.min(
      config.limit,
      bucket.tokens + (timestamp - bucket.lastRefill) * refillPerMs
    );
    bucket.lastRefill = timestamp;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    this.buckets.set(key, bucket);
    const waitMs = (1 - bucket.tokens) / refillPerMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  /** Drops buckets idle for longer than two windows, at most once a minute. */
  private sweep(timestamp: number, windowMs: number): void {
    if (timestamp - this.lastSweep < 60_000) return;
    this.lastSweep = timestamp;
    for (const [key, bucket] of this.buckets) {
      if (timestamp - bucket.lastRefill > windowMs * 2) {
        this.buckets.delete(key);
      }
    }
  }
}

const globalLimiter = new TokenBucketLimiter();

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Fixed-window counter in Upstash Redis (INCR + EXPIRE via the REST API). */
async function checkUpstash(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, "");
  const windowSeconds = Math.ceil(config.windowMs / 1000);
  const windowKey = `rl:${key}:${Math.floor(Date.now() / config.windowMs)}`;

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", windowKey],
      ["EXPIRE", windowKey, String(windowSeconds)],
    ]),
  });
  if (!response.ok) {
    // Fail open: a rate-limiter outage must not take the app down.
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const body = (await response.json()) as { result: number }[];
  const count = body[0]?.result ?? 0;
  if (count <= config.limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: windowSeconds };
}

/**
 * Checks the limit for a caller. `key` should combine the endpoint group and
 * the caller identity (user id, or IP for unauthenticated requests).
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (upstashConfigured()) {
    try {
      return await checkUpstash(key, config);
    } catch {
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
  return globalLimiter.check(key, config);
}

/** Shared configs so limits stay consistent across routes. */
export const RATE_LIMITS = {
  /** AI chat + explanations: costly per call. */
  ai: { limit: 20, windowMs: 60_000 },
  /** File uploads and CSV import parsing/commits. */
  upload: { limit: 15, windowMs: 60_000 },
  /** Report exports (PDF/Excel/CSV generation). */
  export: { limit: 10, windowMs: 60_000 },
  /** Billing checkout/portal session creation. */
  billing: { limit: 10, windowMs: 60_000 },
  /** Manual integration syncs. */
  sync: { limit: 6, windowMs: 60_000 },
  /** Help agent: not plan-gated, so rate limiting is the only abuse brake. */
  help: { limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitConfig>;
