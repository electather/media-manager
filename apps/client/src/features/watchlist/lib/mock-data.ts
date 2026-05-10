import type { MediaType } from "@ent-mcp/shared/media";
import type { WatchlistItem, WatchlistMood, RecentLogEntry } from "./types";

const POSTER = (seed: string): string => `https://picsum.photos/seed/${seed}-p/400/600`;
const BACKDROP = (seed: string): string => `https://picsum.photos/seed/${seed}-b/960/540`;

function item(
  mediaType: MediaType,
  id: string,
  title: string,
  year: number,
  runtimeMin: number,
  episodeCount: number | undefined,
  extra: Partial<WatchlistItem>,
): WatchlistItem {
  const facets = episodeCount === undefined ? { runtimeMin } : { runtimeMin, episodeCount };
  return {
    id: `${mediaType}:${id}`,
    tmdbId: id,
    mediaType,
    title,
    year,
    poster: POSTER(id),
    backdrop: BACKDROP(id),
    facets,
    ...extra,
  };
}

function movie(
  id: string,
  title: string,
  year: number,
  runtimeMin: number,
  extra: Partial<WatchlistItem> = {},
): WatchlistItem {
  return item("movie", id, title, year, runtimeMin, undefined, extra);
}

function tv(
  id: string,
  title: string,
  year: number,
  runtimeMin: number,
  episodeCount: number,
  extra: Partial<WatchlistItem> = {},
): WatchlistItem {
  return item("tv", id, title, year, runtimeMin, episodeCount, extra);
}

function upcomingTv(
  id: string,
  title: string,
  year: number,
  runtimeMin: number,
  episodeCount: number,
  releaseDate: string,
): WatchlistItem {
  return tv(id, title, year, runtimeMin, episodeCount, {
    status: "unknown",
    facets: { runtimeMin, episodeCount, releaseDate },
  });
}

export const WATCHLIST_ITEMS: WatchlistItem[] = [
  movie("n-marble", "Marble of the Hour", 2024, 124, {
    status: "available",
    clearLogoText: "MARBLE",
    overview:
      "A retired conservator returns to her childhood seaside town to authenticate a forgotten sculpture.",
    genres: ["Drama", "Mystery"],
    rating: 7.6,
  }),
  movie("n-blue-hour", "The Blue Hour", 2023, 109, {
    status: "available",
    overview: "Two estranged sisters spend a single evening reckoning with a shared inheritance.",
    genres: ["Drama"],
    rating: 7.2,
  }),
  movie("n-water-lily", "Water Lily", 2022, 118, {
    status: "available",
    overview: "A muralist drifts through Kyoto, painting from memory.",
    genres: ["Drama"],
    rating: 7.0,
  }),
  tv("n-portal", "Portal Nine", 2024, 52, 8, {
    status: "available",
    progress: { watched: 23, total: 52 },
    seriesContext: { season: 1, episode: 4, episodeTitle: "Cold Aperture", nextUpFromServer: true },
  }),
  tv("n-gateway", "Gateway", 2023, 48, 10, {
    status: "available",
    overview: "An interstellar lighthouse keeper tracks an anomaly across decades.",
    genres: ["Sci-Fi"],
  }),
  movie("n-sunset", "Sunset Approximation", 2024, 96, {
    status: "available",
    genres: ["Sci-Fi"],
  }),
  movie("n-hollow", "Hollow Star", 2023, 132, {
    status: "available",
    progress: { watched: 78, total: 132 },
  }),
  tv("after-party", "The After Party", 2024, 32, 8, {
    status: "available",
    genres: ["Comedy"],
  }),
  tv("n-lantern", "Lantern", 2022, 55, 6, {
    status: "available",
    genres: ["Drama", "History"],
  }),
  movie("t-2", "Lateral Thinking", 2024, 92, { status: "available", genres: ["Comedy"] }),
  movie("t-4", "Two Quiet Cities", 2023, 102, { status: "available", genres: ["Comedy", "Drama"] }),
  movie("t-7", "The Last Sub-letter", 2024, 105, {
    status: "available",
    genres: ["Thriller"],
  }),
  movie("n-ember", "Ember", 2024, 119, {
    status: "requested",
    overview: "A volcanologist's last assignment.",
  }),
  movie("n-tessera", "Tessera", 2024, 132, { status: "requested" }),
  tv("n-quartz", "Quartz", 2023, 50, 8, { status: "unavailable" }),
  movie("n-northwind", "Northwind", 2022, 110, { status: "unavailable" }),
  tv("n-cinder", "Cinder", 2023, 44, 8, { status: "unavailable", genres: ["Horror"] }),
  tv("n-borderline", "Borderline", 2024, 50, 6, { status: "unavailable", genres: ["Horror"] }),
  upcomingTv("drama-01", "The Long Approach", 2025, 50, 8, "Mar 14"),
  upcomingTv("long-walk", "The Long Walk", 2025, 48, 6, "Apr 02"),
  upcomingTv("halcyon", "Halcyon", 2025, 50, 8, "May 19"),
  upcomingTv("sovereigns", "Sovereigns", 2025, 55, 10, "Jun 07"),
  tv("n-meridian", "Meridian", 2024, 50, 6, { status: "available", genres: ["Drama"] }),
  tv("n-anchor", "Anchor", 2023, 48, 8, { status: "available", genres: ["Thriller"] }),
  tv("n-ledger", "The Ledger", 2024, 50, 6, { status: "available", genres: ["Thriller"] }),
  tv("n-still", "Still Life", 2023, 50, 6, { status: "available", genres: ["Drama"] }),
];

export const WATCHLIST_ITEM_INDEX: ReadonlyMap<string, WatchlistItem> = new Map(
  WATCHLIST_ITEMS.map((it) => [it.id, it]),
);

export const WATCHLIST_MOODS: WatchlistMood[] = [
  {
    id: "slow-burn",
    labelKey: "watchlist_mood_slow_burn",
    noteKey: "watchlist_mood_slow_burn_note",
    itemIds: ["movie:n-blue-hour", "movie:n-water-lily", "tv:n-meridian"],
  },
  {
    id: "quiet-thrill",
    labelKey: "watchlist_mood_quiet_thrill",
    noteKey: "watchlist_mood_quiet_thrill_note",
    itemIds: ["tv:n-anchor", "movie:t-7", "tv:n-ledger"],
  },
  {
    id: "period",
    labelKey: "watchlist_mood_period",
    noteKey: "watchlist_mood_period_note",
    itemIds: ["movie:n-marble", "tv:n-still", "tv:n-lantern"],
  },
  {
    id: "scifi",
    labelKey: "watchlist_mood_scifi",
    noteKey: "watchlist_mood_scifi_note",
    itemIds: ["tv:n-gateway", "movie:n-hollow", "movie:n-sunset"],
  },
  {
    id: "comedy",
    labelKey: "watchlist_mood_comedy",
    noteKey: "watchlist_mood_comedy_note",
    itemIds: ["tv:after-party", "movie:t-2", "movie:t-4"],
  },
  {
    id: "horror",
    labelKey: "watchlist_mood_horror",
    noteKey: "watchlist_mood_horror_note",
    itemIds: ["tv:n-cinder", "tv:n-borderline"],
  },
];

export const WATCHLIST_RECENT_LOG: RecentLogEntry[] = [
  {
    itemId: "movie:n-marble",
    time: { kind: "hours-ago", n: 2 },
    sourceKey: "watchlist_recent_source_recommended",
  },
  {
    itemId: "tv:n-gateway",
    time: { kind: "yesterday" },
    sourceKey: "watchlist_recent_source_notification",
  },
  {
    itemId: "movie:n-hollow",
    time: { kind: "yesterday" },
    sourceKey: "watchlist_recent_source_search",
  },
  {
    itemId: "tv:long-walk",
    time: { kind: "days-ago", n: 3 },
    sourceKey: "watchlist_recent_source_trending",
  },
  {
    itemId: "movie:n-ember",
    time: { kind: "last-week" },
    sourceKey: "watchlist_recent_source_friend",
  },
];
