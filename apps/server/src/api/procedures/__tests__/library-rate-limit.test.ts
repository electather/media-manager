import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { unauthorized } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;
vi.mock("../../../auth", () => ({
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
}));

vi.mock("../../../catalog", () => ({ getCatalogService: () => ({}), toCanonicalRow: vi.fn() }));
vi.mock("../../../artwork", () => ({
  ArtworkService: vi.fn(function ArtworkService() {
    return { getArtwork: vi.fn(async () => ({ results: {} })) };
  }),
}));
vi.mock("../../../media", () => ({
  MediaService: vi.fn(function MediaService() {
    return {};
  }),
  // `media.ts` imports these at module load; the library router never reaches them.
  addItem: vi.fn(),
  removeItem: vi.fn(),
  decode: vi.fn(),
  listRows: vi.fn(),
  loadProgressMap: vi.fn(),
  StatusBatchMemo: vi.fn(function StatusBatchMemo() {
    return {};
  }),
}));
// `media.ts` spreads these source barrels into its REGISTRY at module load.
vi.mock("../../../home", () => ({
  homeMediaSources: {},
  buildContext: vi.fn(),
  composeDetails: vi.fn(),
  composeSeasonAvailability: vi.fn(),
}));
vi.mock("../../../watchlist", () => ({
  watchlistMediaSources: {},
  getMoodSummary: vi.fn(),
}));

// Stub the library service so the route returns without touching the db; the
// rate limit gate runs before the handler regardless.
const getFacetsSpy = vi.fn();
const listCollectionsSpy = vi.fn();
vi.mock("../../../library", () => ({
  getFacets: getFacetsSpy,
  listCollections: listCollectionsSpy,
  // `media.ts` (reached via the shared `watchlistReadLimiter` import) spreads this
  // into its source REGISTRY at module load; an empty map is enough here.
  libraryMediaSources: {},
}));

const { libraryApp } = await import("../library");
// The library router shares the read-family bucket owned by the media router.
const { watchlistReadLimiter } = await import("../media");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/library", libraryApp)
    .onError(errorHandler);
}

function getFacets(userId: string) {
  mockUserId = userId;
  return buildApp().request("/library/facets", { method: "GET" });
}

beforeEach(() => {
  mockUserId = null;
  getFacetsSpy.mockReset().mockResolvedValue({ total: 0 });
  listCollectionsSpy.mockReset().mockResolvedValue({ collections: [] });
  watchlistReadLimiter.reset();
});

describe("/library rate limit (§A7)", () => {
  it("returns 429 with Retry-After and mcp.rate_limited when the read bucket drains", async () => {
    // The router-level middleware debits the shared read bucket (capacity 30) per
    // request; drain it directly so the next call is rejected before the handler.
    expect(watchlistReadLimiter.check("u1", 30)).toBeNull();
    const res = await getFacets("u1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(((await res.json()) as { code: string }).code).toBe("mcp.rate_limited");
    // The expensive read is skipped when rate-limited.
    expect(getFacetsSpy).not.toHaveBeenCalled();
  });

  it("debits the shared read bucket on a successful facets read", async () => {
    const res = await getFacets("u1");
    expect(res.status).toBe(200);
    // One token was spent, so a 30-token check now fails (29 remain) — proving the
    // middleware is wired. Guards against an accidental removal of the `.use(...)`.
    expect(watchlistReadLimiter.check("u1", 30)).not.toBeNull();
  });

  it("isolates the read bucket per user", async () => {
    expect(watchlistReadLimiter.check("userA", 30)).toBeNull();
    const drained = await getFacets("userA");
    expect(drained.status).toBe(429);

    // user B's bucket is independent.
    const fresh = await getFacets("userB");
    expect(fresh.status).toBe(200);
  });
});
