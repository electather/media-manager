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
    // Treat the test as running behind a trusted proxy so the X-Forwarded-For
    // keying paths below are exercised; the no-trust path is covered explicitly
    // via resolveClientIp(c, false).
    TRUST_PROXY: true,
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

const { makeRateLimitMiddleware, clientIp, resolveClientIp } = await import("../rate-limit");
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

/** Mirrors how the public groups are mounted in `router.ts`: no `requireSession`,
 *  the IP-keyed limiter guards a session-less handler. Each test builds its own
 *  limiter so buckets never bleed across cases. */
function buildPublicApp(middleware: ReturnType<typeof makeRateLimitMiddleware>) {
  return new Hono()
    .use("*", requestContextMiddleware())
    .use("*", middleware)
    .get("/trending", (c) => {
      handler();
      return c.json({ posters: [] });
    })
    .onError(errorHandler);
}

describe("public per-IP rate limit", () => {
  it("returns 429 once the bucket is exhausted for a given IP", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSec: 0 });
    const app = buildPublicApp(makeRateLimitMiddleware({ limiter, key: clientIp }));
    const fromIp = { headers: { "x-forwarded-for": "203.0.113.7" } };

    // The capacity-2 bucket clears the first two reads, then rejects the third
    // before it reaches the handler.
    expect((await app.request("/trending", fromIp)).status).toBe(200);
    expect((await app.request("/trending", fromIp)).status).toBe(200);

    const limited = await app.request("/trending", fromIp);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(((await limited.json()) as { code: string }).code).toBe("mcp.rate_limited");
    // Only the two allowed reads reached the handler; the throttled one did not.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("buckets each client IP independently", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    const app = buildPublicApp(makeRateLimitMiddleware({ limiter, key: clientIp }));

    // One IP drains its own single-token bucket...
    expect(
      (await app.request("/trending", { headers: { "x-forwarded-for": "198.51.100.1" } })).status,
    ).toBe(200);
    expect(
      (await app.request("/trending", { headers: { "x-forwarded-for": "198.51.100.1" } })).status,
    ).toBe(429);

    // ...while a different IP is unaffected.
    expect(
      (await app.request("/trending", { headers: { "x-forwarded-for": "198.51.100.2" } })).status,
    ).toBe(200);
  });

  it("the /config/public/* mount also covers the bare /config/public path", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
    // Mirror router.ts exactly: the limiter is mounted on the prefix glob while
    // the config app serves GET "/", so the real request path is the bare
    // /config/public (no trailing segment). The 429 on the second hit proves the
    // glob middleware fires on the bare path, not just on sub-paths.
    const app = new Hono()
      .use("*", requestContextMiddleware())
      .use("/config/public/*", makeRateLimitMiddleware({ limiter, key: clientIp }))
      .route(
        "/config/public",
        new Hono().get("/", (c) => c.json({ ok: true })),
      )
      .onError(errorHandler);
    const fromIp = { headers: { "x-forwarded-for": "203.0.113.9" } };
    expect((await app.request("/config/public", fromIp)).status).toBe(200);
    expect((await app.request("/config/public", fromIp)).status).toBe(429);
  });

  // Builds a fake context with an X-Forwarded-For header and a mocked socket
  // peer address (via the Bun-style c.env.server.requestIP).
  const ctx = (xff: string | undefined, peer = "10.9.8.7") =>
    ({
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? xff : undefined),
        raw: {},
      },
      env: { server: { requestIP: () => ({ address: peer }) } },
    }) as unknown as Parameters<typeof resolveClientIp>[0];

  it("keys on the first x-forwarded-for hop when the proxy is trusted", () => {
    // A proxy appends downstream hops; the leftmost entry is the original client.
    expect(resolveClientIp(ctx("1.2.3.4, 10.0.0.1"), true)).toBe("1.2.3.4");
    // clientIp() reads env.TRUST_PROXY, which the mock sets true.
    expect(clientIp(ctx("1.2.3.4, 10.0.0.1"))).toBe("1.2.3.4");
  });

  it("ignores a forged x-forwarded-for when the proxy is not trusted", () => {
    // Direct exposure: the header is attacker-controlled, so key on the peer.
    expect(resolveClientIp(ctx("1.2.3.4"), false)).toBe("10.9.8.7");
  });

  it("falls back to the socket peer address when there is no x-forwarded-for", () => {
    expect(resolveClientIp(ctx(undefined), true)).toBe("10.9.8.7");
  });
});
