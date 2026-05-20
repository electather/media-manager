import { describe, it, expect } from "vite-plus/test";
import { WatchlistV1 } from "../watchlist";
import { WatchHistoryV1 } from "../watch-history";

// Trakt returns `null` for items without an IMDb entry (obscure / regional
// titles). The shared idBundle must accept null so those entries don't fail
// validation and degrade the surrounding response. See issue #424. Two
// capabilities are exercised to prove the fix lives on the shared schema,
// not just one method.
describe("shared mediaItem.ids", () => {
  const itemWithNullImdb = {
    id: "movie:1",
    title: "x",
    year: 2020,
    type: "movie" as const,
    rating: null,
    posterUrl: null,
    ids: { trakt_id: "1", imdb_id: null },
  };

  it("accepts a null imdb_id on watchlist output", () => {
    const r = WatchlistV1.methods.getWatchlist.output.safeParse([
      { item: itemWithNullImdb, addedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(r.success).toBe(true);
  });

  it("accepts a null imdb_id on history output", () => {
    const r = WatchHistoryV1.methods.getHistory.output.safeParse([
      { item: itemWithNullImdb, watchedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(r.success).toBe(true);
  });
});
