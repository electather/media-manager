import { describe, it, expect } from "vite-plus/test";
import { TokenBucketLimiter } from "../../../mcp/rate-limit";

describe("artwork rate limiter", () => {
  it("limits individual users independently", () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSec: 0 });
    expect(limiter.check("a")).toBeNull();
    expect(limiter.check("a")).toBeNull();
    // user a is now exhausted.
    expect(limiter.check("a")).not.toBeNull();
    // user b has their own bucket and is still allowed.
    expect(limiter.check("b")).toBeNull();
  });
});
