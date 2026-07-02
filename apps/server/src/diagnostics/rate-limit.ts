export interface RateLimitOptions {
  /** Bucket capacity — the burst allowance. */
  capacity: number;
  /** Tokens refilled per second. A call consumes one token. */
  refillPerSec: number;
  /**
   * Drop a full, idle bucket after at least this many ms; eviction never changes a limiting decision (recreating a full bucket is indistinguishable from it never being seen).
   * Bounds the key→bucket map by active keys, not all keys ever seen — critical for IP-keyed public limiter.
   * Non-positive values clamped to 1 ms. Defaults to {@link DEFAULT_IDLE_EVICTION_MS}.
   */
  idleEvictionMs?: number;
}

/** Throttle verdict: seconds (rounded up) until the next token is available. */
export interface RateLimitExceeded {
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Default idle-eviction window: 10 minutes. */
const DEFAULT_IDLE_EVICTION_MS = 10 * 60 * 1000;

/**
 * Per-subject token-bucket rate limiter keyed by caller-provided string (user id, IP, …).
 * In-process only; single-replica correct, multi-instance needs shared store follow-up.
 * Bounded via idle eviction so unbounded namespaces (e.g. public IPs) cannot accumulate per-key entry.
 * Wire-shape-neutral: `check` returns {@link RateLimitExceeded} on throttle so callers map it to
 * their own error (McpError, HttpError, …) — keeps this infra decoupled from any adapter.
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
   * Evicts buckets full and idle ≥ idleEvictionMs, throttled to one O(n) pass per window (others O(1)).
   * Retains still-draining buckets (actively limiting), so eviction never resets mid-throttle; dropping full+idle is a no-op anyway.
   */
  // fallow-ignore-next-line complexity
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
   * Consumes `count` tokens (default 1); returns null on success, {@link RateLimitExceeded} on failure.
   * `count > capacity` always fails, so bucket never goes below empty.
   */
  check(key: string, count = 1): RateLimitExceeded | null {
    const now = Date.now();
    this.sweepIdle(now);
    const bucket = this.advance(key, now);
    if (count <= this.capacity && bucket.tokens >= count) {
      bucket.tokens -= count;
      return null;
    }
    const missing = count - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(missing / this.refillPerSec));
    return { retryAfterSec };
  }

  reset(): void {
    this.buckets.clear();
    this.lastSweepAt = 0;
  }
}
