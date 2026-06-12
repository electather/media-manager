import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import type { WatchlistMoodSummary } from "@ent-mcp/shared/watchlist";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = "u1";

vi.mock("../../../auth", async () => {
  const { unauthorized } = await import("../../../diagnostics/http-errors");
  return {
    requireSession: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: { get: (k: string) => unknown }) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
  };
});

vi.mock("../../../catalog", () => ({ getCatalogService: () => ({}), toCanonicalRow: vi.fn() }));
vi.mock("../../../artwork", () => ({
  ArtworkService: vi.fn(function ArtworkService() {
    return { getArtwork: vi.fn(async () => ({ results: {} })) };
  }),
}));

// Writes bridge to the media-owned writes barrel (design §A6); stub `addItem` /
// `removeItem` so the bridge + status codes are asserted without the db. The
// other media exports only need to exist for module load.
vi.mock("../../../media", async () => {
  const shared = await import("@ent-mcp/shared/media");
  return {
    addItem: vi.fn(),
    removeItem: vi.fn(),
    decode: shared.decode,
    listRows: vi.fn(),
    loadProgressMap: vi.fn(),
    MediaService: vi.fn(function MediaService() {
      return {};
    }),
    StatusBatchMemo: vi.fn(function StatusBatchMemo() {
      return {};
    }),
  };
});

// `homeMediaSources` only needs to exist for the resolver's module-load REGISTRY
// spread; the composers are unused here.
vi.mock("../../../home", () => ({
  homeMediaSources: {},
  buildContext: vi.fn((userId: string) => ({ userId })),
  composeDetails: vi.fn(),
  composeSeasonAvailability: vi.fn(),
}));

// Counts / moods bridge to the watchlist service (design §A6).
vi.mock("../../../watchlist", () => ({
  watchlistMediaSources: {},
  getMoodSummary: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
}));

// `media.ts` calls `rateLimitOrNull` directly in the `/sources/:sourceId` resolver.
// Mock only that import (pass-through) so moods/write tests are unaffected by
// resolver rate-limit logic; keep the real `makeRateLimitMiddleware` so the
// route-scoped middleware actually debits the real buckets (tested below).
vi.mock("../../rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../rate-limit");
  return { ...actual, rateLimitOrNull: vi.fn(() => null) };
});

const media = await import("../../../media");
const watchlist = await import("../../../watchlist");
const { rateLimitOrNull } = await import("../../rate-limit");
const { watchlistReadLimiter, watchlistWriteLimiter } = await import("../media");
const { mediaApp } = await import("../media");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/media", mediaApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

const MOODS_FIXTURE: WatchlistMoodSummary = {
  clusters: [
    { moodId: "cozy", count: 5 },
    { moodId: "epic", count: 2 },
  ],
};

const ADD_ITEM = {
  id: "movie:550",
  tmdbId: "550",
  mediaType: "movie" as const,
  title: "Fight Club",
  addedAt: 123,
  addedSource: "manual" as const,
};

beforeEach(() => {
  mockUserId = "u1";
  vi.mocked(media.addItem).mockReset();
  vi.mocked(media.removeItem).mockReset();
  vi.mocked(watchlist.getMoodSummary).mockReset();
  vi.mocked(rateLimitOrNull).mockReset().mockReturnValue(null);
  // The route-scoped middleware debits the real buckets, so reset them per test
  // to keep each case independent.
  watchlistReadLimiter.reset();
  watchlistWriteLimiter.reset();
});

describe("media moods / writes (US-005, design §A6/§A7)", () => {
  it("requires a session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/media/moods");
    expect(res.status).toBe(401);
  });

  it("bridges GET /moods to watchlist.getMoodSummary", async () => {
    vi.mocked(watchlist.getMoodSummary).mockResolvedValueOnce(MOODS_FIXTURE);
    const res = await buildApp().request("/media/moods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MOODS_FIXTURE);
    expect(watchlist.getMoodSummary).toHaveBeenCalledTimes(1);
  });

  it("POST /watchlist bridges to the media writes barrel and 201s a fresh insert", async () => {
    vi.mocked(media.addItem).mockResolvedValueOnce({ item: ADD_ITEM, wasActive: false });
    const res = await buildApp().request("/media/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: "550", mediaType: "movie", source: "manual" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ item: ADD_ITEM, wasActive: false });
    expect(media.addItem).toHaveBeenCalledTimes(1);
    const [key, source, ctx] = vi.mocked(media.addItem).mock.calls[0]!;
    expect(key).toEqual({ tmdbId: "550", mediaType: "movie" });
    expect(source).toBe("manual");
    expect(ctx).toMatchObject({ userId: "u1" });
  });

  it("POST /watchlist 200s when the row was already active", async () => {
    vi.mocked(media.addItem).mockResolvedValueOnce({ item: ADD_ITEM, wasActive: true });
    const res = await buildApp().request("/media/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: "550", mediaType: "movie" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { wasActive: boolean }).wasActive).toBe(true);
  });

  it("DELETE /watchlist/:type/:tmdbId bridges to removeItem and 204s", async () => {
    vi.mocked(media.removeItem).mockResolvedValueOnce({ removed: true });
    const res = await buildApp().request("/media/watchlist/tv/1396", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(media.removeItem).toHaveBeenCalledTimes(1);
    const [key, ctx] = vi.mocked(media.removeItem).mock.calls[0]!;
    expect(key).toEqual({ tmdbId: "1396", mediaType: "tv" });
    expect(ctx).toMatchObject({ userId: "u1" });
  });

  it("DELETE rejects an unknown :type with 400 http.invalid_input", async () => {
    const res = await buildApp().request("/media/watchlist/anime/550", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("http.invalid_input");
    expect(media.removeItem).not.toHaveBeenCalled();
  });

  it("DELETE rejects a non-numeric :tmdbId with 400 (validation parity)", async () => {
    const res = await buildApp().request("/media/watchlist/movie/not-a-number", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    expect(media.removeItem).not.toHaveBeenCalled();
  });

  // Rate-limit policy (§A7): reads (moods) use the read limiter, writes use the
  // write limiter — the same buckets the old routes used. The middleware now
  // debits the real bucket, so we assert by observing which bucket drains rather
  // than by spying on the internal helper.
  it("applies watchlistReadLimiter to moods (debits the read bucket, not the write bucket)", async () => {
    vi.mocked(watchlist.getMoodSummary).mockResolvedValue(MOODS_FIXTURE);
    const app = buildApp();
    await app.request("/media/moods");
    // The read bucket lost a token for the moods read; the write bucket is full.
    // `check()` is destructive on SUCCESS (tokens consumed) — the passing write
    // assertion below drains 30. `beforeEach` resets both buckets, so this is safe
    // as the last assertion, but a request added after it would see an empty bucket.
    expect(watchlistReadLimiter.check("u1", 30)).not.toBeNull();
    expect(watchlistWriteLimiter.check("u1", 30)).toBeNull();
  });

  it("applies watchlistWriteLimiter to add and remove (debits the write bucket twice)", async () => {
    vi.mocked(media.addItem).mockResolvedValueOnce({ item: ADD_ITEM, wasActive: false });
    vi.mocked(media.removeItem).mockResolvedValueOnce({ removed: true });
    const app = buildApp();
    await app.request("/media/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: "550", mediaType: "movie" }),
    });
    await app.request("/media/watchlist/movie/550", { method: "DELETE" });
    // Two writes drained two tokens from the write bucket; the read bucket is full.
    expect(watchlistWriteLimiter.check("u1", 29)).not.toBeNull();
    expect(watchlistReadLimiter.check("u1", 30)).toBeNull();
  });

  it("rejects a schema-invalid POST /watchlist with 400 without debiting the write bucket", async () => {
    // The write limiter is mounted AFTER `zValidator` (§A7 parity), so a bad body
    // 400s before any token is charged — matching the old inline `rateLimitOrNull`
    // call that ran only after `c.req.valid("json")`.
    const res = await buildApp().request("/media/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: 550, mediaType: "anime" }),
    });
    expect(res.status).toBe(400);
    expect(media.addItem).not.toHaveBeenCalled();
    // The full write bucket survived the rejected request.
    expect(watchlistWriteLimiter.check("u1", 30)).toBeNull();
  });

  it("short-circuits with a 429 before touching the service when the read bucket is empty", async () => {
    // Drain the read bucket for u1 (capacity 30) so the middleware rejects.
    expect(watchlistReadLimiter.check("u1", 30)).toBeNull();
    const res = await buildApp().request("/media/moods");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(((await res.json()) as { code: string }).code).toBe("mcp.rate_limited");
    expect(watchlist.getMoodSummary).not.toHaveBeenCalled();
  });
});
