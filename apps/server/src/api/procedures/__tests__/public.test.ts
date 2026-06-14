import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";
import type { CanonicalMetadata } from "@nama/shared/catalog";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const getTrendingMetadata = vi.fn<(limit: number) => Promise<CanonicalMetadata[]>>();

vi.mock("../../../catalog", () => ({
  getCatalogService: () => ({ getTrendingMetadata }),
}));

const { publicTrendingApp } = await import("../public");

function makeMeta(init: {
  tmdbId: string;
  mediaType?: "movie" | "tv";
  title?: string;
  posterUrl?: string | null;
}): CanonicalMetadata {
  const { tmdbId, mediaType = "movie", title = "Heat", posterUrl = "/poster.jpg" } = init;
  return {
    tmdbId,
    mediaType,
    title,
    year: 1995,
    runtimeMinutes: null,
    posterUrl,
    backdropUrl: "/backdrop.jpg",
    clearLogoUrl: null,
    overview: "secret overview",
    originalLanguage: "en",
    genres: ["Drama"],
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/public", publicTrendingApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("public/trending API", () => {
  it("returns 200 for a logged-out request (no session required)", async () => {
    getTrendingMetadata.mockResolvedValueOnce([makeMeta({ tmdbId: "550" })]);
    const res = await buildApp().request("/public/trending");
    expect(res.status).toBe(200);
  });

  it("projects only { id, title, poster } and leaks no user/session fields", async () => {
    getTrendingMetadata.mockResolvedValueOnce([
      makeMeta({ tmdbId: "550", title: "Fight Club", posterUrl: "/fc.jpg" }),
    ]);
    const res = await buildApp().request("/public/trending");
    const body = (await res.json()) as { posters: Record<string, unknown>[] };
    expect(body.posters).toEqual([{ id: "movie:550", title: "Fight Club", poster: "/fc.jpg" }]);
    // Guard against accidental leakage of any extra field.
    const [first] = body.posters;
    expect(Object.keys(first ?? {}).sort()).toEqual(["id", "poster", "title"]);
  });

  it("drops items whose poster is null or empty and does not pad", async () => {
    getTrendingMetadata.mockResolvedValueOnce([
      makeMeta({ tmdbId: "1", posterUrl: "/a.jpg" }),
      makeMeta({ tmdbId: "2", posterUrl: null }),
      makeMeta({ tmdbId: "3", posterUrl: "" }),
      makeMeta({ tmdbId: "4", mediaType: "tv", posterUrl: "/d.jpg" }),
    ]);
    const res = await buildApp().request("/public/trending");
    const body = (await res.json()) as { posters: { id: string }[] };
    expect(body.posters.map((p) => p.id)).toEqual(["movie:1", "tv:4"]);
  });

  it("defaults limit to 48 when missing", async () => {
    getTrendingMetadata.mockResolvedValueOnce([]);
    await buildApp().request("/public/trending");
    expect(getTrendingMetadata).toHaveBeenCalledWith(48);
  });

  it("forwards a valid in-range limit", async () => {
    getTrendingMetadata.mockResolvedValueOnce([]);
    await buildApp().request("/public/trending?limit=12");
    expect(getTrendingMetadata).toHaveBeenCalledWith(12);
  });

  it("clamps limit above the max to 96", async () => {
    getTrendingMetadata.mockResolvedValueOnce([]);
    await buildApp().request("/public/trending?limit=500");
    expect(getTrendingMetadata).toHaveBeenCalledWith(96);
  });

  it("falls back to 48 for zero, negative, and non-numeric input", async () => {
    for (const raw of ["0", "-5", "abc"]) {
      getTrendingMetadata.mockResolvedValueOnce([]);
      const res = await buildApp().request(`/public/trending?limit=${raw}`);
      expect(res.status).toBe(200);
      expect(getTrendingMetadata).toHaveBeenLastCalledWith(48);
    }
  });

  it("returns 200 with an empty list when the feed is unavailable", async () => {
    getTrendingMetadata.mockResolvedValueOnce([]);
    const res = await buildApp().request("/public/trending");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posters: [] });
  });

  it("exposes only /trending — sibling/auth paths are not reachable", async () => {
    const res = await buildApp().request("/public/discover");
    expect(res.status).toBe(404);
  });
});
