import { describe, expect, it } from "vite-plus/test";
import provider from "../your-watchlist";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import type { CanonicalMetadata } from "../../../catalog/types";

function meta(tmdbId: string, mediaType: "movie" | "tv" = "movie"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title: `T${tmdbId}`,
    year: 2024,
    runtimeMinutes: 90,
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

describe("rows/your-watchlist", () => {
  it("filters to titles present on a connected library server", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getWatchlistFeed: { mockResolvedValue: (v: unknown) => void };
        getMatchingServers: { mockImplementation: (fn: unknown) => void };
      }
    ).getWatchlistFeed.mockResolvedValue({
      items: [
        libraryItem({ tmdbId: "1", type: "movie" }),
        libraryItem({ tmdbId: "2", type: "show" }),
        libraryItem({ tmdbId: "3", type: "movie" }),
      ],
      partial: false,
    });
    // Items 1 and 3 are on Jellyfin; item 2 is watchlist-only.
    (
      ctx.mediaService as unknown as {
        getMatchingServers: { mockImplementation: (fn: unknown) => void };
      }
    ).getMatchingServers.mockImplementation(async (tmdbId: string) =>
      tmdbId === "2" ? [] : [{ id: "jellyfin", label: "Jellyfin" }],
    );
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({
      "movie:1": meta("1"),
      "movie:3": meta("3"),
    });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId).sort()).toEqual(["1", "3"]);
    expect(page.cursor).toBeNull();
  });

  it("unwraps `{ item, addedAt }` watchlist entries when reading the tmdb id", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getWatchlistFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getWatchlistFeed.mockResolvedValue({
      items: [
        // Trakt + most providers wrap entries; the tmdb id lives on `item.ids`.
        { item: { ids: { tmdb_id: "42" }, type: "movie" }, addedAt: "2026-01-01" },
      ],
      partial: false,
    });
    (
      ctx.mediaService as unknown as {
        getMatchingServers: { mockResolvedValue: (v: unknown) => void };
      }
    ).getMatchingServers.mockResolvedValue([{ id: "jellyfin", label: "Jellyfin" }]);
    (
      ctx.catalog as unknown as { getMetadataBatch: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadataBatch.mockResolvedValue({ "movie:42": meta("42") });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["42"]);
  });

  it("propagates partial=true from the watchlist aggregate", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getWatchlistFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getWatchlistFeed.mockResolvedValue({ items: [], partial: true });
    const page = await provider.fetchPage(ctx, null);
    expect(page.partial).toBe(true);
  });
});
