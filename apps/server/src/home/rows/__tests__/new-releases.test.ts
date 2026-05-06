import { describe, expect, it } from "vite-plus/test";
import provider from "../new-releases";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import type { CanonicalMetadata, MetadataKey } from "../../../catalog/types";

function meta(tmdbId: string, mediaType: "movie" | "tv" = "movie"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title: `T${tmdbId}`,
    year: 2026,
    runtimeMinutes: 100,
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

describe("rows/new-releases", () => {
  it("queries discover_snapshots with feedKind='newReleases' + sort='popularity_desc'", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getDiscoverFeed: { mockResolvedValue: (v: unknown) => void } }
    ).getDiscoverFeed.mockResolvedValue([{ tmdbId: "1", type: "movie" }]);
    (
      ctx.catalog as unknown as {
        getMetadataBatch: {
          mockResolvedValue: (v: unknown) => void;
          mockImplementation: (fn: unknown) => void;
        };
      }
    ).getMetadataBatch.mockImplementation(async (keys: MetadataKey[]) =>
      Object.fromEntries(keys.map((k) => [`movie:${k.tmdbId}`, meta(k.tmdbId)])),
    );

    expect(await provider.eligibility(ctx)).toBe(true);
    const page = await provider.fetchPage(ctx, null);
    expect(page.items).toHaveLength(1);
    expect(
      (
        ctx.catalog as unknown as {
          getDiscoverFeed: { mock: { calls: unknown[][] } };
        }
      ).getDiscoverFeed.mock.calls[0]?.slice(0, 2),
    ).toEqual(["newReleases", "popularity_desc"]);
  });
});
