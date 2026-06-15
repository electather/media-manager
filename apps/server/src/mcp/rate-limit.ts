import { rateLimited } from "./errors";

export interface RateLimitOptions {
  /** Bucket capacity — the burst allowance. */
  capacity: number;
  /** Tokens refilled per second. A call consumes one token. */
  refillPerSec: number;
  /**
   * Drop a bucket once it has refilled to capacity and gone untouched for at
   * least this many milliseconds. A full, idle bucket is indistinguishable from
   * a never-seen key — recreating it on the next access yields the same full
   * bucket — so eviction never changes a limiting decision; it only reclaims
   * memory. This bounds the key→bucket map by the keys *active* within the
   * window (or still draining) rather than by every key ever seen, which
   * matters for the IP-keyed public limiter facing the internet. Non-positive
   * values are clamped to 1 ms. Defaults to {@link DEFAULT_IDLE_EVICTION_MS}.
   */
  idleEvictionMs?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Default idle-eviction window: 10 minutes. */
const DEFAULT_IDLE_EVICTION_MS = 10 * 60 * 1000;

/**
 * Per-user token-bucket rate limiter. Keyed by a caller-provided subject
 * (typically the JWT `sub` claim). Entirely in-process; multi-instance
 * deployments will want a shared store in a follow-up, but the current
 * behavior is already correct for a single-replica deployment.
 *
 * The key→bucket map is kept bounded by evicting buckets that have refilled to
 * full and gone idle (see {@link RateLimitOptions.idleEvictionMs}), so a
 * limiter keyed by an unbounded namespace (e.g. public client IPs) cannot
 * accumulate an entry per key ever seen.
 */
export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly idleEvictionMs: number;
  private readonly buckets = new Map<string, Bucket>();
  /** Wall-clock of the last full sweep. Throttles eviction to one pass per
   *  window so a hot limiter does not walk the whole map on every call. */
  private lastSweepAt = 0;

  constructor(options: RateLimitOptions) {
    this.capacity = options.capacity;
    this.refillPerSec = options.refillPerSec;
    this.idleEvictionMs = Math.max(1, options.idleEvictionMs ?? DEFAULT_IDLE_EVICTION_MS);
  }

  /**
   * Evicts every bucket that has refilled to capacity and not been touched for
   * at least `idleEvictionMs`. Throttled to one pass per window: the first call
   * after a window elapses pays the O(n) walk, every other call is O(1). A
   * still-draining bucket (would not be full even after the idle gap) is always
   * retained — it is actively limiting — so eviction can never reset a caller
   * mid-throttle; dropping a full+idle bucket is a no-op since recreating it
   * yields the same full bucket.
   */
  private sweepIdle(now: number): void {
    if (now - this.lastSweepAt < this.idleEvictionMs) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      const idleMs = now - bucket.updatedAt;
      if (idleMs < this.idleEvictionMs) continue;
      const refilled = bucket.tokens + (idleMs / 1000) * this.refillPerSec;
      if (refilled >= this.capacity) this.buckets.delete(key);
    }
  }

  /** Number of live buckets. Exposed so eviction is observable in tests; the
   *  limiting decision never depends on it. */
  get size(): number {
    return this.buckets.size;
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
    this.sweepIdle(now);
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
    this.lastSweepAt = 0;
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
