import { rateLimited } from "./errors";

export interface RateLimitOptions {
  /** Bucket capacity — the burst allowance. */
  capacity: number;
  /** Tokens refilled per second. A call consumes one token. */
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-user token-bucket rate limiter. Keyed by a caller-provided subject
 * (typically the JWT `sub` claim). Entirely in-process; multi-instance
 * deployments will want a shared store in a follow-up, but the current
 * behavior is already correct for a single-replica deployment.
 */
export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    this.capacity = options.capacity;
    this.refillPerSec = options.refillPerSec;
  }

  private advance(key: string, now: number): Bucket {
    const existing = this.buckets.get(key);
    if (!existing) {
      const fresh: Bucket = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, fresh);
      return fresh;
    }
    const elapsed = (now - existing.updatedAt) / 1000;
    if (elapsed > 0) {
      existing.tokens = Math.min(this.capacity, existing.tokens + elapsed * this.refillPerSec);
      existing.updatedAt = now;
    }
    return existing;
  }

  /**
   * Consumes `count` tokens for `key` (defaults to 1). Returns `null` on
   * success; on failure returns an `McpError` with `details.retry_after`
   * (seconds, rounded up). `count` larger than `capacity` always fails so
   * the bucket can never go more than empty.
   */
  check(key: string, count = 1): ReturnType<typeof rateLimited> | null {
    const now = Date.now();
    const bucket = this.advance(key, now);
    if (count <= this.capacity && bucket.tokens >= count) {
      bucket.tokens -= count;
      return null;
    }
    const missing = count - bucket.tokens;
    const retryAfter = Math.max(1, Math.ceil(missing / this.refillPerSec));
    return rateLimited(retryAfter);
  }

  reset(): void {
    this.buckets.clear();
  }
}

/**
 * Default limiter used by `/api/mcp`: 60 calls/min with a 60-call burst.
 * Values are intentionally coarse — the goal is to stop runaway agents,
 * not to meter by tool type.
 */
export const defaultMcpLimiter = new TokenBucketLimiter({
  capacity: 60,
  refillPerSec: 1,
});
