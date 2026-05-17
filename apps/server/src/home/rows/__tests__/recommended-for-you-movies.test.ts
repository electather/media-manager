import { describe, expect, it } from "vite-plus/test";
import provider from "../recommended-for-you-movies";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";

function meta(tmdbId: string): CanonicalMetadata {
  return {
    tmdbId,
    mediaType: "movie",
    title: `Movie ${tmdbId}`,
    year: 2024,
    runtimeMinutes: 105,
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

describe("rows/recommended-for-you-movies", () => {
  it("filters mediaType=movie and drops available items", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as {
        getRecommendations: { mockResolvedValue: (v: unknown) => void };
      }
    ).getRecommendations.mockResolvedValue({
      items: [
        { tmdbId: "1", mediaType: "movie", matchReason: null, topContributors: [], score: 0.9 },
        { tmdbId: "2", mediaType: "movie", matchReason: null, topContributors: [], score: 0.8 },
        { tmdbId: "3", mediaType: "tv", matchReason: null, topContributors: [], score: 0.7 },
      ],
      profileVersion: 1,
      generatedAt: 0,
    });
    (
      ctx.statusBatch as unknown as { get: { mockResolvedValue: (v: unknown) => void } }
    ).get.mockResolvedValue({ "movie:1": "unknown", "movie:2": "available" });
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({ "movie:1": meta("1") });

    expect(await provider.eligibility(ctx)).toBe(true);
    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
  });

  it("returns empty when the rec list lacks any movie items", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as {
        getRecommendations: { mockResolvedValue: (v: unknown) => void };
      }
    ).getRecommendations.mockResolvedValue({
      items: [{ tmdbId: "1", mediaType: "tv", matchReason: null, topContributors: [], score: 0.9 }],
      profileVersion: 1,
      generatedAt: 0,
    });
    expect(await provider.eligibility(ctx)).toBe(false);
  });
});
