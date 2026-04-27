import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Hono } from "hono";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import { unauthorized } from "../../../errors/http-errors";

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
vi.mock("../../../auth/middleware", () => ({
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
    constructor(public readonly userId: string) {}
    getArtwork = getArtworkSpy;
  },
}));

const { artworkApp } = await import("../artwork");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/artwork", artworkApp)
    .onError(errorHandler);
}

beforeEach(() => {
  mockUserId = null;
  getArtworkSpy.mockReset();
});

describe("artwork RPC contract", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items: [{ key: "k", ids: { tmdb: "550" }, type: "movie" }] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty items array", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items: [] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getArtworkSpy).not.toHaveBeenCalled();
  });

  it("rejects more than 50 items", async () => {
    mockUserId = "u1";
    const items = Array.from({ length: 51 }, (_, i) => ({
      key: `k${i}`,
      ids: { tmdb: String(i) },
      type: "movie" as const,
    }));
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getArtworkSpy).not.toHaveBeenCalled();
  });

  it("rejects an item missing every id", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items: [{ key: "k", ids: {}, type: "movie" }] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(getArtworkSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed id patterns (imdb without 'tt' prefix)", async () => {
    mockUserId = "u1";
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({
        items: [{ key: "k", ids: { imdb: "0137523" }, type: "movie" }],
      }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("forwards a well-formed batch to ArtworkService and echoes the response", async () => {
    mockUserId = "u1";
    getArtworkSpy.mockResolvedValue({
      results: { k: { poster: [], backdrop: [], clearLogo: [], thumb: [] } },
      generatedAt: 42,
    });
    const items = [{ key: "k", ids: { tmdb: "550" }, type: "movie" as const }];
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({ items, languages: ["en", "00"] }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(getArtworkSpy).toHaveBeenCalledWith(items, ["en", "00"]);
    const body = await res.json();
    expect(body.results.k).toBeDefined();
    expect(body.generatedAt).toBe(42);
  });

  it("accepts a request without a languages field (server defaults apply)", async () => {
    mockUserId = "u1";
    getArtworkSpy.mockResolvedValue({ results: {}, generatedAt: 1 });
    const res = await buildApp().request("/artwork/get", {
      method: "POST",
      body: JSON.stringify({
        items: [{ key: "k", ids: { tmdb: "550" }, type: "movie" }],
      }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(getArtworkSpy).toHaveBeenCalledTimes(1);
    const [, languagesArg] = getArtworkSpy.mock.calls[0]!;
    expect(languagesArg).toBeUndefined();
  });
});
