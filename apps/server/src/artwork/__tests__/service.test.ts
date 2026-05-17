import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { ArtworkBundle } from "@ent-mcp/shared/artwork";
import type { CatalogService } from "../../catalog";

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

// `vi.mock` is hoisted above any module-scope `const`, so `dispatchMock` has
// to be hoisted alongside it — otherwise the factory closure captures
// `undefined` and the call wrapper dies with `TypeError: undefined is not a
// function`.
const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));
vi.mock("../../media", async () => {
  const actual = await vi.importActual<typeof import("../../media")>("../../media");
  return {
    ...actual,
    dispatchAggregatePerKind: dispatchMock,
  };
});

const { ArtworkService } = await import("../service");
const { PluginCallError } = await import("../../media");

function bundle(overrides: Partial<ArtworkBundle> = {}): ArtworkBundle {
  return {
    poster: [],
    backdrop: [],
    clearLogo: [],
    thumb: [],
    ...overrides,
  };
}

function makeCatalogStub(): { stub: CatalogService; patchArtwork: ReturnType<typeof vi.fn> } {
  const patchArtwork = vi.fn().mockResolvedValue(undefined);
  const stub = { patchArtwork } as unknown as CatalogService;
  return { stub, patchArtwork };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => dispatchMock.mockReset());

describe("ArtworkService", () => {
  it("dispatches one call per canonical (idsHash, type) and echoes back every client key", async () => {
    dispatchMock.mockResolvedValue(
      bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }),
    );
    const { stub } = makeCatalogStub();
    const service = new ArtworkService("u1", stub);
    // Two distinct client keys map to the same canonical entry — service must
    // collapse them into a single dispatch but still return both keys in the
    // results map.
    const result = await service.getArtwork([
      { key: "row1-card", ids: { tmdb: "550" }, type: "movie" },
      { key: "row2-card", ids: { tmdb: "550" }, type: "movie" },
      { key: "row3-card", ids: { tmdb: "1396" }, type: "tv" },
    ]);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.results).sort()).toEqual(["row1-card", "row2-card", "row3-card"]);
    expect(result.results["row1-card"]).toEqual(result.results["row2-card"]);
    expect(result.errors).toBeUndefined();
  });

  it("captures unsupported_id_combo per item without breaking the batch", async () => {
    // Order matches Map.values() insertion order: movie comes before tv since
    // that is the order the input items are walked into the canonical map.
    dispatchMock
      .mockResolvedValueOnce(bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }))
      .mockRejectedValueOnce(
        new PluginCallError(
          "artwork.unsupported_id_combo",
          "no provider for tv with imdb",
          "",
          null,
        ),
      );
    const { stub } = makeCatalogStub();
    const service = new ArtworkService("u1", stub);
    const result = await service.getArtwork([
      { key: "ok", ids: { tmdb: "550" }, type: "movie" },
      { key: "bad", ids: { imdb: "tt1" }, type: "tv" },
    ]);

    expect(result.results["ok"]).toBeDefined();
    expect(result.results["bad"]).toBeUndefined();
    expect(result.errors?.["bad"]).toEqual({
      code: "unsupported_id_combo",
      message: "no provider for tv with imdb",
    });
  });

  it("maps unexpected dispatch failures to a generic 'internal' per-item error", async () => {
    dispatchMock.mockRejectedValueOnce(new Error("registry blew up"));
    const { stub } = makeCatalogStub();
    const service = new ArtworkService("u1", stub);
    const result = await service.getArtwork([{ key: "k", ids: { tmdb: "550" }, type: "movie" }]);
    expect(result.results["k"]).toBeUndefined();
    expect(result.errors?.["k"]?.code).toBe("internal");
  });

  it("forwards the caller's languages preference into the dispatch input", async () => {
    dispatchMock.mockResolvedValue(bundle());
    const { stub } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork(
      [{ key: "k", ids: { tmdb: "550" }, type: "movie" }],
      ["fr", "en", "00"],
    );
    expect(dispatchMock.mock.calls[0]![0]).toMatchObject({
      input: { ids: { tmdb: "550" }, type: "movie", languages: ["fr", "en", "00"] },
    });
  });

  it("defaults languages to ['en', '00'] when the caller omits it", async () => {
    dispatchMock.mockResolvedValue(bundle());
    const { stub } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "k", ids: { tmdb: "550" }, type: "movie" },
    ]);
    expect(dispatchMock.mock.calls[0]![0]).toMatchObject({
      input: { languages: ["en", "00"] },
    });
  });
});

describe("ArtworkService write-back", () => {
  it("patches canonical with top1 URLs per resolved key", async () => {
    dispatchMock.mockResolvedValue(
      bundle({
        poster: [
          { url: "https://x/p1.jpg", language: "en" },
          { url: "https://x/p2.jpg", language: "00" },
        ],
        backdrop: [{ url: "https://x/bd.jpg", language: "00" }],
        clearLogo: [{ url: "https://x/cl.png", language: "en" }],
      }),
    );
    const { stub, patchArtwork } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "k", ids: { tmdb: "550" }, type: "movie" },
    ]);

    expect(patchArtwork).toHaveBeenCalledTimes(1);
    expect(patchArtwork).toHaveBeenCalledWith(
      { tmdbId: "550", type: "movie" },
      {
        posterUrl: "https://x/p1.jpg",
        backdropUrl: "https://x/bd.jpg",
        clearLogoUrl: "https://x/cl.png",
      },
    );
  });

  it("skips patch when entry has no tmdb id", async () => {
    dispatchMock.mockResolvedValue(bundle());
    const { stub, patchArtwork } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "k", ids: { imdb: "tt1" }, type: "movie" },
    ]);
    expect(patchArtwork).not.toHaveBeenCalled();
  });

  it("does not patch for rejected dispatches", async () => {
    dispatchMock
      .mockResolvedValueOnce(bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }))
      .mockRejectedValueOnce(new Error("dispatch fail"));
    const { stub, patchArtwork } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "ok", ids: { tmdb: "550" }, type: "movie" },
      { key: "bad", ids: { tmdb: "1396" }, type: "tv" },
    ]);
    expect(patchArtwork).toHaveBeenCalledTimes(1);
    expect(patchArtwork).toHaveBeenCalledWith(
      { tmdbId: "550", type: "movie" },
      expect.objectContaining({ posterUrl: "https://x/p.jpg" }),
    );
  });

  it("returns 200 even when patchArtwork rejects", async () => {
    dispatchMock.mockResolvedValue(
      bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }),
    );
    const patchArtwork = vi.fn().mockRejectedValue(new Error("db down"));
    const stub = { patchArtwork } as unknown as CatalogService;

    const result = await new ArtworkService("u1", stub).getArtwork([
      { key: "k", ids: { tmdb: "550" }, type: "movie" },
    ]);
    expect(result.results["k"]).toBeDefined();
    expect(result.errors).toBeUndefined();
    // Allow the swallowed rejection's microtask to settle so an unhandled
    // rejection cannot leak into the next test's harness.
    await flushMicrotasks();
    expect(patchArtwork).toHaveBeenCalledTimes(1);
  });

  it("calls patch once per canonical key even with multiple client keys", async () => {
    dispatchMock.mockResolvedValue(
      bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }),
    );
    const { stub, patchArtwork } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "row1", ids: { tmdb: "550" }, type: "movie" },
      { key: "row2", ids: { tmdb: "550" }, type: "movie" },
    ]);
    expect(patchArtwork).toHaveBeenCalledTimes(1);
  });

  it("skips patch when bundle is fully empty", async () => {
    // Empty bundle → all-null `top1` → patch would only bump
    // `lastRefreshedAt` without writing any URL. Skip so the row stays
    // visible to the nightly stale sweep.
    dispatchMock.mockResolvedValue(bundle());
    const { stub, patchArtwork } = makeCatalogStub();
    await new ArtworkService("u1", stub).getArtwork([
      { key: "k", ids: { tmdb: "550" }, type: "movie" },
    ]);
    expect(patchArtwork).not.toHaveBeenCalled();
  });
});
