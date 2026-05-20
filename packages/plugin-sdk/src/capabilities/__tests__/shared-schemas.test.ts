import { describe, it, expect } from "vite-plus/test";
import { WatchlistV1 } from "../watchlist";

describe("shared mediaItem.ids", () => {
  // Trakt returns `null` for items without an IMDb entry (obscure / regional
  // titles). The schema must accept null so those entries don't fail validation
  // and degrade the surrounding response. See issue #424.
  it("accepts a null imdb_id", () => {
    const r = WatchlistV1.methods.getWatchlist.output.safeParse([
      {
        item: {
          id: "movie:1",
          title: "x",
          year: 2020,
          type: "movie",
          rating: null,
          posterUrl: null,
          ids: { trakt_id: "1", imdb_id: null },
        },
        addedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(r.success).toBe(true);
  });
});
