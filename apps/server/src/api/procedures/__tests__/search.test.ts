import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import { HttpError } from "../../../errors/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;

vi.mock("../../../auth/middleware", async () => {
  const { unauthorized } = await import("../../../errors/http-errors");
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

const search =
  vi.fn<(q: string, type: "movie" | "tv" | undefined, limit?: number) => Promise<unknown>>();

vi.mock("../../../media/service", () => ({
  MediaService: class {
    constructor(public readonly userId: string) {}
    search = search;
  },
}));

const { searchApp } = await import("../search");

interface PluginItemInit {
  tmdbId: string;
  type?: "movie" | "tv";
  title?: string;
  year?: number | null;
  posterUrl?: string | null;
  overview?: string;
  genres?: string[];
  rating?: number | null;
  runtime?: number | null;
}

function makeHit(init: PluginItemInit): { item: Record<string, unknown> } {
  const {
    tmdbId,
    type = "movie",
    title = "Heat",
    year = 1995,
    posterUrl = "https://example/p.jpg",
    overview = "",
    genres = [],
    rating = null,
    runtime = null,
  } = init;
  return {
    item: {
      id: tmdbId,
      title,
      year,
      type,
      posterUrl,
      overview,
      genres,
      rating,
      runtime,
      ids: { tmdb_id: tmdbId },
    },
  };
}

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/search", searchApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("search API", () => {
  it("returns 401 when no session present", async () => {
    mockUserId = null;
    const res = await buildApp().request("/search?q=heat");
    expect(res.status).toBe(401);
  });

  it("returns 200 + mapped results with hasMore=false", async () => {
    mockUserId = "u1";
    search.mockResolvedValueOnce([
      makeHit({ tmdbId: "10", title: "Heat" }),
      makeHit({ tmdbId: "11", title: "Heater", year: 2010 }),
    ]);
    const res = await buildApp().request("/search?q=heat");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { id: string; title: string; mediaType: string }[];
      hasMore: boolean;
    };
    expect(body.hasMore).toBe(false);
    expect(body.results).toEqual([
      expect.objectContaining({ id: "movie:10", tmdbId: "10", title: "Heat", mediaType: "movie" }),
      expect.objectContaining({
        id: "movie:11",
        tmdbId: "11",
        title: "Heater",
        mediaType: "movie",
      }),
    ]);
  });

  it("computes hasMore when hit count exceeds limit", async () => {
    mockUserId = "u1";
    const hits = Array.from({ length: 4 }, (_, i) =>
      makeHit({ tmdbId: String(i), title: `Heat ${i}` }),
    );
    search.mockResolvedValueOnce(hits);
    const res = await buildApp().request("/search?q=heat&limit=3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; hasMore: boolean };
    expect(body.hasMore).toBe(true);
    expect(body.results).toHaveLength(3);
    expect(search).toHaveBeenCalledWith("heat", undefined, 4);
  });

  it("forwards kind filter to the plugin dispatch", async () => {
    mockUserId = "u1";
    search.mockResolvedValueOnce([]);
    const res = await buildApp().request("/search?q=heat&kind=tv");
    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith("heat", "tv", 21);
  });

  it("drops hits missing media type and falls back to raw.id when ids.tmdb_id absent", async () => {
    mockUserId = "u1";
    search.mockResolvedValueOnce([
      makeHit({ tmdbId: "10" }),
      // Missing `type` → dropped.
      { item: { id: "no-type", title: "No Type" } },
      // No `ids.tmdb_id`, but raw.id="11" + type="movie" → kept via fallback.
      { item: { id: "11", title: "Bare Id", type: "movie" } },
    ]);
    const res = await buildApp().request("/search?q=heat");
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]?.id).toBe("movie:10");
    expect(body.results[1]?.id).toBe("movie:11");
  });

  it("returns 500 when the plugin dispatch throws", async () => {
    mockUserId = "u1";
    search.mockRejectedValueOnce(new Error("plugin timeout"));
    const res = await buildApp().request("/search?q=heat");
    expect(res.status).toBe(500);
  });

  it("rejects an unknown kind with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/search?q=heat&kind=podcast");
    expect(res.status).toBe(400);
  });

  it("rejects q over 80 chars with 400", async () => {
    mockUserId = "u1";
    const longQ = "h".repeat(81);
    const res = await buildApp().request(`/search?q=${longQ}`);
    expect(res.status).toBe(400);
  });

  it("rejects empty q with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/search");
    expect(res.status).toBe(400);
  });

  it("caps limit at 50 and rejects 51 with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/search?q=heat&limit=51");
    expect(res.status).toBe(400);
  });
});
