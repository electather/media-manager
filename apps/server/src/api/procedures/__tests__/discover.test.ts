import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let mockUserId: string | null = null;

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

const trending = vi.fn<(type: "movie" | "tv" | undefined, limit?: number) => Promise<unknown>>();

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    MediaService: class {
      constructor(public readonly userId: string) {}
      trending = trending;
    },
  };
});

const { discoverApp } = await import("../discover");

interface RawInit {
  tmdbId: string;
  type?: "movie" | "tv";
  title?: string;
  year?: number | null;
  posterUrl?: string | null;
}

function makeRaw(init: RawInit): Record<string, unknown> {
  const { tmdbId, type = "movie", title = "Heat", year = 1995, posterUrl = null } = init;
  return {
    id: tmdbId,
    title,
    year,
    type,
    posterUrl,
    ids: { tmdb_id: tmdbId },
  };
}

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/discover", discoverApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

describe("discover/trending API", () => {
  it("returns 401 when no session present", async () => {
    mockUserId = null;
    const res = await buildApp().request("/discover/trending");
    expect(res.status).toBe(401);
  });

  it("returns 200 + mapped results with hasMore=false", async () => {
    mockUserId = "u1";
    trending.mockResolvedValueOnce([
      makeRaw({ tmdbId: "10", title: "Heat" }),
      makeRaw({ tmdbId: "11", title: "Heater", year: 2010 }),
    ]);
    const res = await buildApp().request("/discover/trending");
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

  it("forwards mediaType + limit and computes hasMore", async () => {
    mockUserId = "u1";
    const raws = Array.from({ length: 4 }, (_, i) =>
      makeRaw({ tmdbId: String(i), type: "tv", title: `Show ${i}` }),
    );
    trending.mockResolvedValueOnce(raws);
    const res = await buildApp().request("/discover/trending?mediaType=tv&limit=3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; hasMore: boolean };
    expect(body.hasMore).toBe(true);
    expect(body.results).toHaveLength(3);
    expect(trending).toHaveBeenCalledWith("tv", 4);
  });

  it("rejects an invalid mediaType with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/discover/trending?mediaType=podcast");
    expect(res.status).toBe(400);
  });

  it("rejects limit > 50 with 400", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/discover/trending?limit=51");
    expect(res.status).toBe(400);
  });

  it("returns 500 when the plugin dispatch throws", async () => {
    mockUserId = "u1";
    trending.mockRejectedValueOnce(new Error("plugin timeout"));
    const res = await buildApp().request("/discover/trending");
    expect(res.status).toBe(500);
  });
});
