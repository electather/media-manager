import { describe, expect, it } from "vite-plus/test";
import provider from "../upcoming-for-you";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import type { CanonicalMetadata } from "../../../catalog/types";

function meta(tmdbId: string, mediaType: "movie" | "tv" = "tv"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title: `T${tmdbId}`,
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

describe("rows/upcoming-for-you", () => {
  it("returns a single bounded page", async () => {
    const ctx = makeRowCtx();
    const items = Array.from({ length: 20 }, (_, n) => ({
      airDate: "2026-06-01T20:00:00Z",
      airsAt: "2026-06-01T20:00:00Z",
      item: libraryItem({ tmdbId: String(n), type: "show", season: 1, episode: 2 }),
    }));
    (
      ctx.mediaService as unknown as {
        getUpcomingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getUpcomingFeed.mockResolvedValue({ items, partial: false });
    (
      ctx.catalog as unknown as {
        getMetadataBatch: {
          mockResolvedValue: (v: unknown) => void;
          mockImplementation: (fn: unknown) => void;
        };
      }
    ).getMetadataBatch.mockImplementation(async (keys: { tmdbId: string }[]) =>
      Object.fromEntries(keys.map((k) => [`tv:${k.tmdbId}`, meta(k.tmdbId)])),
    );

    const page = await provider.fetchPage(ctx, null);
    expect(page.items).toHaveLength(12);
    expect(page.cursor).toBeNull();
  });

  it("propagates partial=true on calendar plugin partial err", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getUpcomingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getUpcomingFeed.mockResolvedValue({ items: [], partial: true });
    const page = await provider.fetchPage(ctx, null);
    expect(page.partial).toBe(true);
    expect(page.items).toEqual([]);
  });
});
