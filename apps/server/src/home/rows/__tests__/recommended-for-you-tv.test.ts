import { describe, expect, it } from "vite-plus/test";
import provider from "../recommended-for-you-tv";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import type { CanonicalMetadata } from "../../../catalog/types";

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
    ).get.mockResolvedValue({ "1": "unknown", "2": "available" });
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({ "tv:1": meta("1") });

    expect(await provider.eligibility(ctx)).toBe(true);
    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
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

    const page = await provider.fetchPage(ctx, null);
    expect(page.items[0]?.__topContributors).toEqual([
      { category: "genre", value: "Sci-Fi", weight: 0.5 },
    ]);
  });
});
