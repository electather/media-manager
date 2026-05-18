import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { unauthorized } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

let mockUserId: string | null = null;
vi.mock("../../../auth", () => ({
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

const getArtworkSpy = vi.fn();
vi.mock("../../../artwork", () => ({
  ArtworkService: class {
    constructor(
      public readonly userId: string,
      public readonly catalogService: unknown,
    ) {}
    getArtwork = getArtworkSpy;
  },
}));

vi.mock("../../../catalog", () => ({
  getCatalogService: () => ({ patchArtwork: vi.fn() }),
}));

const { artworkApp, artworkLimiter } = await import("../artwork");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/artwork", artworkApp)
    .onError(errorHandler);
}

function postBatch(userId: string, size: number) {
  mockUserId = userId;
  const items = Array.from({ length: size }, (_, i) => ({
    key: `k${i}`,
    ids: { tmdb: String(i + 1) },
    type: "movie" as const,
  }));
  return buildApp().request("/artwork/get", {
    method: "POST",
    body: JSON.stringify({ items }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockUserId = null;
  getArtworkSpy.mockReset();
  getArtworkSpy.mockResolvedValue({ results: {}, generatedAt: 0 });
  artworkLimiter.reset();
});

describe("artwork RPC rate limit", () => {
  it("returns 429 with Retry-After header and mcp.rate_limited code when bucket drains", async () => {
    // 60 single-item calls drain the bucket (capacity=60). 61st must be 429.
    for (let i = 0; i < 60; i++) {
      const res = await postBatch("u1", 1);
      expect(res.status).toBe(200);
    }
    const res = await postBatch("u1", 1);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("mcp.rate_limited");
  });

  it("charges the bucket by unique-canonical-lookup count, not by request count", async () => {
    // One 50-item batch with distinct tmdb ids must consume 50 tokens, so the
    // next 11-item batch (consume 11; only 10 tokens left) must be rate limited.
    const first = await postBatch("u2", 50);
    expect(first.status).toBe(200);

    const second = await postBatch("u2", 11);
    expect(second.status).toBe(429);
  });

  it("dedupes by canonical key when charging — duplicate items cost one token each canonical entry", async () => {
    mockUserId = "u3";
    // 50 items all pointing at the same tmdb id collapse to one canonical
    // lookup, so the bucket is debited by 1 rather than 50.
    const items = Array.from({ length: 50 }, (_, i) => ({
      key: `k${i}`,
      ids: { tmdb: "550" },
      type: "movie" as const,
    }));
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    // 59 more single-item *distinct* calls should still fit (60 - 1 = 59 left).
    for (let i = 0; i < 59; i++) {
      const r = await postBatch("u3", 1);
      expect(r.status).toBe(200);
    }
    const overflow = await postBatch("u3", 1);
    expect(overflow.status).toBe(429);
  });

  it("isolates buckets per user", async () => {
    // Drain user A.
    for (let i = 0; i < 60; i++) {
      const res = await postBatch("userA", 1);
      expect(res.status).toBe(200);
    }
    const drained = await postBatch("userA", 1);
    expect(drained.status).toBe(429);

    // User B has a fresh bucket.
    const fresh = await postBatch("userB", 1);
    expect(fresh.status).toBe(200);
  });

  it("limits a single batch larger than capacity outright", async () => {
    // Schema caps items at 50, but if a future bump raised it past capacity
    // the check must still reject rather than going negative. We exercise the
    // direct-limiter path here since the input schema enforces ≤50.
    const err = artworkLimiter.check("user-huge", 9999);
    expect(err).not.toBeNull();
  });
});
