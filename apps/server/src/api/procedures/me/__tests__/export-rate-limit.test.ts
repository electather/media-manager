import { describe, it, expect } from "vite-plus/test";
import { TokenBucketLimiter } from "../../../../mcp/rate-limit";

describe("export rate limiter", () => {
  it("allows requests within capacity", () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSec: 0 });
    expect(limiter.check("user-1")).toBeNull();
    expect(limiter.check("user-1")).toBeNull();
    expect(limiter.check("user-1")).toBeNull();
  });

  it("blocks requests that exceed capacity", () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSec: 0 });
    limiter.check("user-x");
    limiter.check("user-x");
    expect(limiter.check("user-x")).not.toBeNull();
  });

  it("buckets are per-user (different users are independent)", () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    limiter.check("user-a");
    // user-b should not be blocked by user-a exhausting their bucket.
    expect(limiter.check("user-b")).toBeNull();
  });
});
