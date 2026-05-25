import { describe, expect, it, vi } from "vite-plus/test";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CompactMediaEnrichContext } from "../enrich";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: { listProviders: () => [] },
  };
});

const { enrichCompactItems } = await import("../enrich");

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

function ctx(overrides: Partial<CompactMediaEnrichContext> = {}): CompactMediaEnrichContext {
  return {
    userId: "u1",
    deadlineMs: undefined,
    mediaService: {
      getStatusBatch: vi.fn().mockResolvedValue({}),
      getMatchingServers: vi.fn().mockResolvedValue([]),
      getMetadata: vi.fn().mockResolvedValue(null),
    },
    catalog: {
      getMetadataBatch: vi.fn().mockResolvedValue({}),
    } as never,
    log: {
      warn: vi.fn(),
    } as never,
    ...overrides,
  };
}

describe("enrichCompactItems", () => {
  it("applies canonical metadata artwork when no bundle is needed", async () => {
    const catalogMeta = meta({
      tmdbId: "1",
      posterUrl: "https://img/poster.jpg",
      backdropUrl: "https://img/backdrop.jpg",
      clearLogoUrl: "https://img/logo.png",
    });
    const testCtx = ctx({
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({ "movie:1": catalogMeta }),
      } as never,
    });

    const out = await enrichCompactItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      testCtx,
    );

    expect(out.items[0]?.poster).toBe("https://img/poster.jpg");
    expect(out.items[0]?.backdrop).toBe("https://img/backdrop.jpg");
    expect(out.items[0]?.clearLogo).toBe("https://img/logo.png");
  });

  it("keeps adapter-supplied artwork untouched", async () => {
    const testCtx = ctx({
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:1": meta({ posterUrl: "https://catalog/poster.jpg" }),
        }),
      } as never,
    });

    const out = await enrichCompactItems(
      [
        {
          id: "movie:1",
          tmdbId: "1",
          mediaType: "movie",
          title: "T",
          poster: "https://upstream/poster.jpg",
        },
      ],
      testCtx,
    );

    expect(out.items[0]?.poster).toBe("https://upstream/poster.jpg");
  });

  it("forwards deadlines to status, artwork, and server availability leaves", async () => {
    const deadlineMs = Date.now() + 30_000;
    const statusBatch = { get: vi.fn().mockResolvedValue({ "movie:1": "requested" }) };
    const getArtwork = vi.fn().mockResolvedValue({ results: {}, generatedAt: 0 });
    const getMatchingServers = vi.fn().mockResolvedValue([]);
    const testCtx = ctx({
      deadlineMs,
      statusBatch: statusBatch as unknown as CompactMediaEnrichContext["statusBatch"],
      getArtwork,
      mediaService: {
        getStatusBatch: vi.fn().mockResolvedValue({}),
        getMatchingServers,
        getMetadata: vi.fn().mockResolvedValue(null),
      },
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({ "movie:1": meta({ tmdbId: "1" }) }),
      } as never,
    });

    await enrichCompactItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      testCtx,
    );

    expect(statusBatch.get).toHaveBeenCalledWith(["movie:1"], { deadlineMs });
    expect(getMatchingServers).toHaveBeenCalledWith("1", "movie", { deadlineMs });
    expect(getArtwork).toHaveBeenCalledWith(
      [{ key: "movie:1", ids: { tmdb: "1" }, type: "movie" }],
      { deadlineMs },
    );
  });

  it("projects match reasons and strips private row fields", async () => {
    const row = {
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "T",
      __topContributors: [{ name: "A", weight: 1 }],
      __addedAtMs: 123,
    } satisfies CompactMediaItem & {
      __topContributors: Array<{ name: string; weight: number }>;
      __addedAtMs: number;
    };
    const matchReason = vi.fn().mockReturnValue({
      key: "highly_rated",
      params: {},
    });

    const out = await enrichCompactItems([row], ctx(), { matchReason });

    expect(matchReason).toHaveBeenCalledWith(row);
    expect(out.items[0]?.matchReason).toEqual({ key: "highly_rated", params: {} });
    expect(out.items[0]).not.toHaveProperty("__topContributors");
    expect(out.items[0]).not.toHaveProperty("__addedAtMs");
  });

  it("sets partial and returns items when getStatusBatch rejects", async () => {
    const testCtx = ctx({
      mediaService: {
        getStatusBatch: vi.fn().mockRejectedValue(new Error("batch fail")),
        getMatchingServers: vi.fn().mockResolvedValue([]),
        getMetadata: vi.fn().mockResolvedValue(null),
      },
    });

    const out = await enrichCompactItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      testCtx,
    );

    expect(out.partial).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  it("sets partial and returns items when getMetadataBatch rejects", async () => {
    const testCtx = ctx({
      catalog: {
        getMetadataBatch: vi.fn().mockRejectedValue(new Error("catalog fail")),
      } as never,
    });

    const out = await enrichCompactItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      testCtx,
    );

    expect(out.partial).toBe(true);
    expect(out.items).toHaveLength(1);
  });
});
