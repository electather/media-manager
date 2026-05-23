import { describe, expect, it, vi } from "vite-plus/test";
import { makeRowCtx } from "./row-test-helpers";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const artworkGetSpy = vi.fn().mockResolvedValue({ results: {}, generatedAt: 0 });
vi.mock("../../artwork", () => ({
  ArtworkService: class {
    getArtwork = artworkGetSpy;
  },
}));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: { listProviders: () => [] },
  };
});

const { enrichItems } = await import("../internal/enrich");

function meta(overrides: Partial<CanonicalMetadata>): CanonicalMetadata {
  return {
    tmdbId: "1",
    mediaType: "movie",
    title: "T",
    year: 2024,
    runtimeMinutes: null,
    posterUrl: null,
    backdropUrl: null,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: null,
    genres: null,
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe("enrichItems deadline propagation", () => {
  it("forwards ctx.deadlineMs to statusBatch.get, ArtworkService.getArtwork, getMatchingServers", async () => {
    artworkGetSpy.mockClear();
    const deadlineMs = Date.now() + 30_000;
    const statusGet = vi.fn().mockResolvedValue({});
    const getMatchingServers = vi.fn().mockResolvedValue([]);
    const ctx = makeRowCtx({
      deadlineMs,
      statusBatch: { get: statusGet } as never,
      mediaService: {
        getMatchingServers,
      } as never,
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:1": meta({ tmdbId: "1" }),
        }),
      } as never,
    });
    await enrichItems([{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }], ctx, {
      rowId: "hero",
    });
    expect(statusGet).toHaveBeenCalledWith(["movie:1"], { deadlineMs });
    expect(getMatchingServers).toHaveBeenCalledWith("1", "movie", { deadlineMs });
    // ArtworkService.getArtwork only invoked when catalog metadata is missing
    // some art URLs. The default `meta(...)` factory above has all-null
    // artwork URLs, so hydrateArtwork will request artwork.
    expect(artworkGetSpy).toHaveBeenCalled();
    const artworkCall = artworkGetSpy.mock.calls[0]!;
    expect(artworkCall[2]).toEqual({ deadlineMs });
  });

  it("absorbs AbortError from getMatchingServers; item ships with empty servers", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    const ctx = makeRowCtx({
      deadlineMs: Date.now() + 30_000,
      mediaService: {
        getMatchingServers: vi.fn().mockRejectedValue(abortErr),
      } as never,
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:1": meta({
            tmdbId: "1",
            posterUrl: "https://img/p.jpg",
            backdropUrl: "https://img/b.jpg",
            clearLogoUrl: "https://img/l.png",
          }),
        }),
      } as never,
    });
    const out = await enrichItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      ctx,
      { rowId: "hero" },
    );
    const wire = out[0]!;
    const availability = wire.availability!;
    expect(availability.servers).toEqual([]);
    expect(availability.hasAnyServerCopy).toBe(false);
  });

  it("omits deadlineMs from leaf calls when ctx.deadlineMs is undefined", async () => {
    const statusGet = vi.fn().mockResolvedValue({});
    const getMatchingServers = vi.fn().mockResolvedValue([]);
    const ctx = makeRowCtx({
      deadlineMs: undefined,
      statusBatch: { get: statusGet } as never,
      mediaService: { getMatchingServers } as never,
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:1": meta({
            tmdbId: "1",
            posterUrl: "https://img/p.jpg",
            backdropUrl: "https://img/b.jpg",
            clearLogoUrl: "https://img/l.png",
          }),
        }),
      } as never,
    });
    await enrichItems([{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }], ctx, {
      rowId: "hero",
    });
    expect(statusGet).toHaveBeenCalledWith(["movie:1"], {});
    expect(getMatchingServers).toHaveBeenCalledWith("1", "movie", {});
  });
});
