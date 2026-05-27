import type { WatchlistItem } from "../lib/types";

export function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: "movie:1",
    tmdbId: "1",
    mediaType: "movie",
    title: "Title 1",
    addedAt: 1_700_000_000_000,
    addedSource: "manual",
    ...overrides,
  };
}

export const SAMPLE_WATCHLIST: WatchlistItem[] = [
  makeItem({
    id: "movie:11",
    tmdbId: "11",
    title: "Horror One",
    genres: ["Horror", "Thriller"],
    addedAt: 1_700_000_000_000,
  }),
  makeItem({
    id: "movie:12",
    tmdbId: "12",
    title: "Horror Two",
    genres: ["Horror"],
    addedAt: 1_700_000_001_000,
  }),
  makeItem({
    id: "movie:13",
    tmdbId: "13",
    title: "Horror Three",
    genres: ["Horror"],
    addedAt: 1_700_000_002_000,
  }),
  makeItem({
    id: "tv:21",
    tmdbId: "21",
    mediaType: "tv",
    title: "SciFi Show",
    genres: ["Sci-Fi & Fantasy", "Drama"],
    addedAt: 1_700_000_003_000,
  }),
  makeItem({
    id: "movie:31",
    tmdbId: "31",
    title: "Numeric Genres",
    genres: ["28", "12"],
    addedAt: 1_700_000_004_000,
  }),
];
