import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
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

vi.mock("../../../catalog", () => ({ getCatalogService: () => ({}) }));
vi.mock("../../../media", () => ({
  MediaService: vi.fn(function MediaService() {
    return {};
  }),
}));

vi.mock("../../../watchlist", () => ({
  addItem: vi.fn(),
  removeItem: vi.fn(),
  getCounts: vi.fn(),
  getMoodSummary: vi.fn(),
  getRecentlyAdded: vi.fn(),
  getTonightSection: vi.fn(),
  listItems: vi.fn(),
  listMoodItems: vi.fn(),
}));

const watchlist = await import("../../../watchlist");
const { watchlistApp, watchlistReadLimiter } = await import("../watchlist");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/watchlist", watchlistApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

function resetMocks() {
  vi.mocked(watchlist.listItems).mockReset();
  vi.mocked(watchlist.getCounts).mockReset();
  vi.mocked(watchlist.getTonightSection).mockReset();
  vi.mocked(watchlist.getRecentlyAdded).mockReset();
  vi.mocked(watchlist.getMoodSummary).mockReset();
  vi.mocked(watchlist.listMoodItems).mockReset();
  // Drain the read limiter so per-user buckets don't bleed across cases.
  watchlistReadLimiter.reset?.();
}

describe("watchlist API", () => {
  it("requires a session", async () => {
    resetMocks();
    mockUserId = null;
    const res = await buildApp().request("/watchlist/counts");
    expect(res.status).toBe(401);
    mockUserId = "u1";
  });

  it("returns counts from getCounts", async () => {
    resetMocks();
    vi.mocked(watchlist.getCounts).mockResolvedValueOnce({
      ready: 1,
      inProgress: 0,
      awaiting: 0,
      unavailable: 0,
      upcoming: 0,
      total: 1,
    });
    const res = await buildApp().request("/watchlist/counts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ready: 1,
      inProgress: 0,
      awaiting: 0,
      unavailable: 0,
      upcoming: 0,
      total: 1,
    });
  });

  it("delegates /items to listItems and parses sort + bucket", async () => {
    resetMocks();
    vi.mocked(watchlist.listItems).mockResolvedValueOnce({
      items: [],
      cursor: null,
      partial: false,
    });
    const res = await buildApp().request("/watchlist/items?sort=alpha&bucket=ready");
    expect(res.status).toBe(200);
    expect(watchlist.listItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sort: "alpha", bucket: "ready" }),
    );
  });

  it("accepts the rev-6 unavailable bucket on /items", async () => {
    resetMocks();
    vi.mocked(watchlist.listItems).mockResolvedValueOnce({
      items: [],
      cursor: null,
      partial: false,
    });
    const res = await buildApp().request("/watchlist/items?bucket=unavailable");
    expect(res.status).toBe(200);
    expect(watchlist.listItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: "unavailable" }),
    );
  });

  it("rejects an invalid sort with 400", async () => {
    resetMocks();
    const res = await buildApp().request("/watchlist/items?sort=banana");
    expect(res.status).toBe(400);
  });

  it("rejects an invalid bucket with 400 (zod enum guard)", async () => {
    resetMocks();
    const res = await buildApp().request("/watchlist/items?bucket=banana");
    expect(res.status).toBe(400);
  });

  it("rejects an unknown moodId with 400", async () => {
    resetMocks();
    const res = await buildApp().request("/watchlist/moods/banana/items");
    expect(res.status).toBe(400);
  });

  it("delegates /sections/tonight to getTonightSection", async () => {
    resetMocks();
    vi.mocked(watchlist.getTonightSection).mockResolvedValueOnce({ items: [], partial: false });
    const res = await buildApp().request("/watchlist/sections/tonight");
    expect(res.status).toBe(200);
    expect(watchlist.getTonightSection).toHaveBeenCalledTimes(1);
  });

  it("delegates /sections/recently with the parsed limit", async () => {
    resetMocks();
    vi.mocked(watchlist.getRecentlyAdded).mockResolvedValueOnce({ items: [], partial: false });
    const res = await buildApp().request("/watchlist/sections/recently?limit=10");
    expect(res.status).toBe(200);
    expect(watchlist.getRecentlyAdded).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("delegates /moods to getMoodSummary", async () => {
    resetMocks();
    vi.mocked(watchlist.getMoodSummary).mockResolvedValueOnce({ clusters: [] });
    const res = await buildApp().request("/watchlist/moods");
    expect(res.status).toBe(200);
  });

  it("delegates /moods/:moodId/items to listMoodItems", async () => {
    resetMocks();
    vi.mocked(watchlist.listMoodItems).mockResolvedValueOnce({
      items: [],
      cursor: null,
      partial: false,
    });
    const res = await buildApp().request("/watchlist/moods/cozy/items");
    expect(res.status).toBe(200);
    expect(watchlist.listMoodItems).toHaveBeenCalledWith(expect.anything(), "cozy", {
      limit: 60,
    });
  });
});
