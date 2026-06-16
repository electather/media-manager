import { describe, expect, it, vi } from "vite-plus/test";
import provider from "../recommended-for-you-tv";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import type { RowContext } from "../../internal/types";
import type { CanonicalMetadata } from "@nama/shared/catalog";

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

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

function meta(tmdbId: string, mediaType: "movie" | "tv" = "tv"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title: `Title ${tmdbId}`,
    year: 2024,
    runtimeMinutes: 50,
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
  };
}

describe("rows/recommended-for-you-tv", () => {
  it("eligibility=false when no rec list exists", async () => {
    const ctx = makeRowCtx();
    expect(await provider.eligibility(ctx)).toBe(false);
  });

  it("filters mediaType=tv and drops status='available' items", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getRecommendations: { mockResolvedValue: (v: unknown) => void } }
    ).getRecommendations.mockResolvedValue({
      items: [
        {
          tmdbId: "1",
          mediaType: "tv",
          matchReason: null,
          topContributors: [{ category: "genre", value: "Drama", weight: 0.4 }],
          score: 0.9,
        },
        { tmdbId: "2", mediaType: "tv", matchReason: null, topContributors: [], score: 0.8 },
        { tmdbId: "3", mediaType: "movie", matchReason: null, topContributors: [], score: 0.7 },
      ],
      profileVersion: 1,
      generatedAt: 0,
    });
    (
      ctx.statusBatch as unknown as { get: { mockResolvedValue: (v: unknown) => void } }
    ).get.mockResolvedValue({ "tv:1": "unknown", "tv:2": "available" });
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({ "tv:1": meta("1") });

    expect(await provider.eligibility(ctx)).toBe(true);
    const page = await provider.load(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
  });

  it("eligibility reads the rec list through the injected memo, not the catalog", async () => {
    // `buildContext` injects a request-scoped `recommendations` memo so the two
    // partition rows + the source + hero share one rec-list fetch. The
    // eligibility branch must read through it (sharing the result) rather than
    // hitting `catalog.getRecommendations` itself — symmetric with the source's
    // memo test in `sources/__tests__/recommended-for-you.test.ts`.
    const recommendations = vi.fn().mockResolvedValue({
      items: [{ tmdbId: "1", mediaType: "tv", matchReason: null, topContributors: [], score: 0.9 }],
      profileVersion: 1,
      generatedAt: 0,
    });
    const ctx = makeRowCtx({ recommendations: recommendations as RowContext["recommendations"] });

    expect(await provider.eligibility(ctx)).toBe(true);
    expect(recommendations).toHaveBeenCalledTimes(1);
    expect(
      (ctx.catalog as unknown as { getRecommendations: { mock: { calls: unknown[] } } })
        .getRecommendations.mock.calls,
    ).toHaveLength(0);
  });

  it("carries topContributors through to enrichment via __topContributors", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getRecommendations: { mockResolvedValue: (v: unknown) => void } }
    ).getRecommendations.mockResolvedValue({
      items: [
        {
          tmdbId: "1",
          mediaType: "tv",
          matchReason: null,
          topContributors: [{ category: "genre", value: "Sci-Fi", weight: 0.5 }],
          score: 0.9,
        },
      ],
      profileVersion: 1,
      generatedAt: 0,
    });
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({ "tv:1": meta("1") });

    const page = await provider.load(ctx, null);
    expect((page.items[0] as { __topContributors?: unknown })?.__topContributors).toEqual([
      { category: "genre", value: "Sci-Fi", weight: 0.5 },
    ]);
  });
});
