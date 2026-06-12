import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../diagnostics/middleware";
import { unauthorized } from "../../diagnostics/http-errors";

// Stub env so the auth module's transitive imports don't trip over missing env.
vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

// The default key strategy reads `sessionUserId`, so we stub the auth barrel the
// same way the route tests do.
let mockUserId: string | null = null;
vi.mock("../../auth", () => ({
  requireSession: async (c: any, next: any) => {
    if (!mockUserId) throw unauthorized();
    c.set("session", { user: { id: mockUserId } });
    await next();
  },
  sessionUserId: (c: any) => {
    const session = c.get("session") as { user: { id: string } } | undefined;
    if (!session) throw unauthorized();
    return session.user.id;
  },
}));

const { makeRateLimitMiddleware } = await import("../rate-limit");
const { TokenBucketLimiter } = await import("../../mcp/rate-limit");
const { requireSession } = await import("../../auth");

const handler = vi.fn();

/** A tiny router that mirrors the production wiring: requireSession sets the
 *  session, then the rate-limit middleware guards the handler. */
function buildApp(middleware: ReturnType<typeof makeRateLimitMiddleware>) {
  return new Hono()
    .use("*", requestContextMiddleware())
    .use("*", requireSession)
    .use("*", middleware)
    .get("/thing", (c) => {
      handler();
      return c.json({ ok: true });
    })
    .onError(errorHandler);
}

beforeEach(() => {
  mockUserId = "u1";
  handler.mockReset();
});

describe("makeRateLimitMiddleware", () => {
  it("passes the request through while the bucket has tokens", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSec: 0 });
    const app = buildApp(makeRateLimitMiddleware({ limiter }));

    const first = await app.request("/thing");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("short-circuits with the shared 429 body + Retry-After when the bucket drains", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    const app = buildApp(makeRateLimitMiddleware({ limiter }));

    expect((await app.request("/thing")).status).toBe(200);

    const limited = await app.request("/thing");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = (await limited.json()) as { code: string };
    expect(body.code).toBe("mcp.rate_limited");
    // The blocked request never reaches the handler.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keys per user by default, so one user draining does not throttle another", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    const app = buildApp(makeRateLimitMiddleware({ limiter }));

    mockUserId = "drainer";
    expect((await app.request("/thing")).status).toBe(200);
    expect((await app.request("/thing")).status).toBe(429);

    mockUserId = "fresh";
    expect((await app.request("/thing")).status).toBe(200);
  });

  it("charges `cost` tokens per request", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSec: 0 });
    const app = buildApp(makeRateLimitMiddleware({ limiter, cost: 2 }));

    // First request debits 2 of 3; second needs 2 but only 1 remains → 429.
    expect((await app.request("/thing")).status).toBe(200);
    expect((await app.request("/thing")).status).toBe(429);
  });

  it("honors a custom key strategy", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    // Key by a fixed constant so every caller shares one bucket regardless of user.
    const app = buildApp(makeRateLimitMiddleware({ limiter, key: () => "shared" }));

    mockUserId = "a";
    expect((await app.request("/thing")).status).toBe(200);
    mockUserId = "b";
    expect((await app.request("/thing")).status).toBe(429);
  });
});
