import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TokenBucketLimiter } from "../rate-limit";

// PR #588 added `publicIpLimiter`, keyed by public client IPs — an
// internet-facing, unbounded key namespace. TokenBucketLimiter must therefore
// reclaim buckets it no longer needs instead of keeping an entry per key ever
// seen. Eviction is deliberately invisible to the limiting *decision*: a bucket
// that has refilled to capacity and gone idle is indistinguishable from a
// never-seen key (recreating it yields the same full bucket), so `check()`
// alone cannot reveal whether a stale entry was reclaimed. These tests observe
// the bucket count (`size`) directly to pin the eviction down.
describe("TokenBucketLimiter — idle bucket eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts buckets that refilled to full and went idle, retaining recently-touched ones", () => {
    const idleEvictionMs = 60_000;
    const limiter = new TokenBucketLimiter({ capacity: 10, refillPerSec: 1, idleEvictionMs });

    // Two keys hit once then abandoned, plus one we keep touching.
    expect(limiter.check("abandoned-a")).toBeNull();
    expect(limiter.check("abandoned-b")).toBeNull();
    expect(limiter.check("kept-warm")).toBeNull();
    expect(limiter.size).toBe(3);

    // Touch "kept-warm" again just inside the window so it stays recent.
    vi.setSystemTime(idleEvictionMs - 1);
    expect(limiter.check("kept-warm")).toBeNull();

    // Cross the window and touch a new key: that access triggers the throttled
    // sweep. The two abandoned keys refilled to full and sat idle past the
    // window → evicted. "kept-warm" was touched within the window → retained.
    // "fresh" is created by this very call.
    vi.setSystemTime(idleEvictionMs + 1);
    expect(limiter.check("fresh")).toBeNull();
    expect(limiter.size).toBe(2);

    // Identity check: touching the retained key adds no entry (still present),
    // while touching an evicted key recreates it (entry count grows).
    expect(limiter.check("kept-warm")).toBeNull();
    expect(limiter.size).toBe(2);
    expect(limiter.check("abandoned-a")).toBeNull();
    expect(limiter.size).toBe(3);
  });

  it("retains a still-draining bucket idle past the window, so eviction never resets an active throttle", () => {
    const idleEvictionMs = 60_000;
    // Refill slow enough that a drained bucket stays below capacity far past
    // the eviction window — it is actively limiting and must not be reclaimed.
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0.0001, idleEvictionMs });

    expect(limiter.check("noisy")).toBeNull(); // drains the single token
    expect(limiter.check("noisy")).not.toBeNull(); // bucket empty → throttled
    expect(limiter.size).toBe(1);

    // Sit idle far past the window, then touch a different key to run the sweep.
    // "noisy" has barely refilled (well below capacity), so it is not a
    // full+idle bucket and survives.
    vi.setSystemTime(idleEvictionMs * 10);
    expect(limiter.check("other")).toBeNull();
    expect(limiter.size).toBe(2);

    // ...and it is still throttled: eviction did not silently hand it a fresh,
    // full bucket that would let the caller skip its limit.
    expect(limiter.check("noisy")).not.toBeNull();
  });
});
