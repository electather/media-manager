import * as m from "@/paraglide/messages";
import type { MoodGroup, RecentLogEntry, WatchlistItem } from "./types";

/**
 * Mock watchlist payload. Hand-crafted to exercise every section of the
 * editorial layout (in-progress, ready, requested, unavailable, upcoming,
 * mood-clustered) before real fetchers replace it. All imagery is sourced
 * from picsum.photos so the mock survives offline review.
 */

const img = (seed: string, w: number, h: number): string =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

const poster = (seed: string): string => img(seed, 600, 900);
const backdrop = (seed: string): string => img(seed, 1600, 900);

const ITEMS: readonly WatchlistItem[] = [
  {
    id: "movie:n-marble",
    tmdbId: "marble-1",
    mediaType: "movie",
    title: "Marble Halls",
    year: 2021,
    poster: poster("marble-poster"),
    backdrop: backdrop("marble-bd"),
    clearLogoText: "MARBLE·HALLS",
    overview:
      "A barrister learns the cost of mercy in a courtroom built from inherited stone. Long takes, careful framing, the weight of every decision.",
    genres: ["Drama", "Period"],
    rating: 7.9,
    facets: { runtimeMin: 124 },
    matchReasonText:
      "Quiet, deliberate. Fits a long evening with no interruptions, the way you watched 'Aurora Drift'.",
  },
  {
    id: "movie:n-blue-hour",
    tmdbId: "blue-hour-1",
    mediaType: "movie",
    title: "Blue Hour",
    year: 2022,
    poster: poster("bluehour-poster"),
    backdrop: backdrop("bluehour-bd"),
    clearLogoText: "BLUE·HOUR",
    genres: ["Drama"],
    rating: 8.1,
    facets: { runtimeMin: 108 },
    progress: { watched: 38, total: 100 },
  },
  {
    id: "movie:n-water-lily",
    tmdbId: "water-lily-1",
    mediaType: "movie",
    title: "Water Lily",
    year: 2020,
    poster: poster("waterlily-poster"),
    backdrop: backdrop("waterlily-bd"),
    genres: ["Drama"],
    rating: 7.6,
    facets: { runtimeMin: 96 },
    status: "available",
  },
  {
    id: "tv:n-portal",
    tmdbId: "portal-1",
    mediaType: "tv",
    title: "Portal Echoes",
    year: 2024,
    poster: poster("portal-poster"),
    backdrop: backdrop("portal-bd"),
    clearLogoText: "PORTAL·ECHOES",
    genres: ["Sci-Fi", "Drama"],
    rating: 8.4,
    facets: { runtimeMin: 52, episodeCount: 8 },
  },
  {
    id: "tv:n-gateway",
    tmdbId: "gateway-1",
    mediaType: "tv",
    title: "The Gateway",
    year: 2024,
    poster: poster("gateway-poster"),
    backdrop: backdrop("gateway-bd"),
    genres: ["Sci-Fi", "Mystery"],
    rating: 8.7,
    facets: { runtimeMin: 48, episodeCount: 10 },
    status: "available",
  },
  {
    id: "movie:n-sunset",
    tmdbId: "sunset-1",
    mediaType: "movie",
    title: "Sunset Frequency",
    year: 2023,
    poster: poster("sunset-poster"),
    backdrop: backdrop("sunset-bd"),
    genres: ["Sci-Fi"],
    rating: 7.4,
    facets: { runtimeMin: 119 },
  },
  {
    id: "movie:n-hollow",
    tmdbId: "hollow-1",
    mediaType: "movie",
    title: "Hollow Light",
    year: 2024,
    poster: poster("hollow-poster"),
    backdrop: backdrop("hollow-bd"),
    genres: ["Sci-Fi", "Drama"],
    rating: 7.9,
    facets: { runtimeMin: 132 },
  },
  {
    id: "tv:after-party",
    tmdbId: "afterparty-1",
    mediaType: "tv",
    title: "After Party",
    year: 2023,
    poster: poster("afterparty-poster"),
    backdrop: backdrop("afterparty-bd"),
    genres: ["Comedy"],
    rating: 8.0,
    facets: { runtimeMin: 28, episodeCount: 12 },
  },
  {
    id: "tv:n-lantern",
    tmdbId: "lantern-1",
    mediaType: "tv",
    title: "Lantern Court",
    year: 2022,
    poster: poster("lantern-poster"),
    backdrop: backdrop("lantern-bd"),
    genres: ["Period", "Drama"],
    rating: 8.3,
    facets: { runtimeMin: 55, episodeCount: 8 },
  },
  {
    id: "movie:t-2",
    tmdbId: "t2-1",
    mediaType: "movie",
    title: "Tessellate",
    year: 2023,
    poster: poster("tessellate-poster"),
    backdrop: backdrop("tessellate-bd"),
    genres: ["Comedy"],
    rating: 7.2,
    facets: { runtimeMin: 102 },
  },
  {
    id: "movie:t-4",
    tmdbId: "t4-1",
    mediaType: "movie",
    title: "Plain Sailing",
    year: 2022,
    poster: poster("plainsailing-poster"),
    backdrop: backdrop("plainsailing-bd"),
    genres: ["Comedy"],
    rating: 6.8,
    facets: { runtimeMin: 91 },
  },
  {
    id: "movie:t-7",
    tmdbId: "t7-1",
    mediaType: "movie",
    title: "Quiet Quarter",
    year: 2024,
    poster: poster("quietquarter-poster"),
    backdrop: backdrop("quietquarter-bd"),
    genres: ["Thriller"],
    rating: 7.7,
    facets: { runtimeMin: 116 },
  },
  // Awaiting / requested
  {
    id: "movie:n-ember",
    tmdbId: "ember-1",
    mediaType: "movie",
    title: "Ember Light",
    year: 2023,
    poster: poster("ember-poster"),
    backdrop: backdrop("ember-bd"),
    genres: ["Drama"],
    facets: { runtimeMin: 105 },
    status: "requested",
  },
  {
    id: "movie:n-tessera",
    tmdbId: "tessera-1",
    mediaType: "movie",
    title: "Tessera",
    year: 2024,
    poster: poster("tessera-poster"),
    backdrop: backdrop("tessera-bd"),
    genres: ["Drama"],
    facets: { runtimeMin: 110 },
    status: "requested",
  },
  // Unavailable / needs request
  {
    id: "tv:n-quartz",
    tmdbId: "quartz-1",
    mediaType: "tv",
    title: "Quartz",
    year: 2024,
    poster: poster("quartz-poster"),
    backdrop: backdrop("quartz-bd"),
    genres: ["Mystery"],
    facets: { runtimeMin: 50, episodeCount: 6 },
    status: "unavailable",
  },
  {
    id: "movie:n-northwind",
    tmdbId: "northwind-1",
    mediaType: "movie",
    title: "Northwind",
    year: 2022,
    poster: poster("northwind-poster"),
    backdrop: backdrop("northwind-bd"),
    genres: ["Adventure"],
    facets: { runtimeMin: 138 },
    status: "unavailable",
  },
  {
    id: "tv:n-cinder",
    tmdbId: "cinder-1",
    mediaType: "tv",
    title: "Cinder",
    year: 2023,
    poster: poster("cinder-poster"),
    backdrop: backdrop("cinder-bd"),
    genres: ["Horror"],
    facets: { runtimeMin: 44, episodeCount: 8 },
    status: "unavailable",
  },
  {
    id: "tv:n-borderline",
    tmdbId: "borderline-1",
    mediaType: "tv",
    title: "Borderline",
    year: 2024,
    poster: poster("borderline-poster"),
    backdrop: backdrop("borderline-bd"),
    genres: ["Horror", "Mystery"],
    facets: { runtimeMin: 52, episodeCount: 6 },
    status: "unavailable",
  },
  // Upcoming
  {
    id: "tv:drama-01",
    tmdbId: "drama01-1",
    mediaType: "tv",
    title: "The Long Hour",
    year: 2026,
    poster: poster("longhour-poster"),
    backdrop: backdrop("longhour-bd"),
    genres: ["Drama"],
    facets: { runtimeMin: 50, episodeCount: 8, releaseDate: "2026-05-12" },
  },
  {
    id: "tv:long-walk",
    tmdbId: "longwalk-1",
    mediaType: "tv",
    title: "Long Walk Home",
    year: 2026,
    poster: poster("longwalk-poster"),
    backdrop: backdrop("longwalk-bd"),
    genres: ["Drama"],
    facets: { runtimeMin: 52, episodeCount: 6, releaseDate: "2026-05-22" },
  },
  {
    id: "tv:halcyon",
    tmdbId: "halcyon-1",
    mediaType: "tv",
    title: "Halcyon",
    year: 2026,
    poster: poster("halcyon-poster"),
    backdrop: backdrop("halcyon-bd"),
    genres: ["Sci-Fi"],
    facets: { runtimeMin: 48, episodeCount: 10, releaseDate: "2026-06-01" },
  },
  {
    id: "tv:sovereigns",
    tmdbId: "sovereigns-1",
    mediaType: "tv",
    title: "Sovereigns",
    year: 2026,
    poster: poster("sovereigns-poster"),
    backdrop: backdrop("sovereigns-bd"),
    genres: ["Period", "Drama"],
    facets: { runtimeMin: 55, episodeCount: 8, releaseDate: "2026-06-14" },
  },
  // Mood-only fillers
  {
    id: "tv:n-meridian",
    tmdbId: "meridian-1",
    mediaType: "tv",
    title: "Meridian",
    year: 2023,
    poster: poster("meridian-poster"),
    backdrop: backdrop("meridian-bd"),
    genres: ["Drama"],
    rating: 7.8,
    facets: { runtimeMin: 50, episodeCount: 6 },
  },
  {
    id: "tv:n-anchor",
    tmdbId: "anchor-1",
    mediaType: "tv",
    title: "Anchor Point",
    year: 2024,
    poster: poster("anchor-poster"),
    backdrop: backdrop("anchor-bd"),
    genres: ["Thriller"],
    rating: 8.1,
    facets: { runtimeMin: 48, episodeCount: 8 },
  },
  {
    id: "tv:n-ledger",
    tmdbId: "ledger-1",
    mediaType: "tv",
    title: "The Ledger",
    year: 2023,
    poster: poster("ledger-poster"),
    backdrop: backdrop("ledger-bd"),
    genres: ["Thriller"],
    rating: 7.9,
    facets: { runtimeMin: 52, episodeCount: 8 },
  },
  {
    id: "tv:n-still",
    tmdbId: "still-1",
    mediaType: "tv",
    title: "Still Lives",
    year: 2022,
    poster: poster("still-poster"),
    backdrop: backdrop("still-bd"),
    genres: ["Period"],
    rating: 8.0,
    facets: { runtimeMin: 50, episodeCount: 6 },
  },
];

const ID_INDEX = new Map(ITEMS.map((it) => [it.id, it] as const));

export function listMockWatchlist(): readonly WatchlistItem[] {
  return ITEMS;
}

function pick(id: string): WatchlistItem | null {
  return ID_INDEX.get(id) ?? null;
}

function pickAll(ids: readonly string[]): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const id of ids) {
    const it = pick(id);
    if (it) out.push(it);
  }
  return out;
}

export function listMockMoodGroups(): MoodGroup[] {
  return [
    {
      id: "slow-burn",
      labelKey: "watchlist_mood_slow_burn_label",
      noteKey: "watchlist_mood_slow_burn_note",
      items: pickAll(["movie:n-blue-hour", "movie:n-water-lily", "tv:n-meridian"]),
    },
    {
      id: "quiet-thrill",
      labelKey: "watchlist_mood_quiet_thrill_label",
      noteKey: "watchlist_mood_quiet_thrill_note",
      items: pickAll(["tv:n-anchor", "movie:t-7", "tv:n-ledger"]),
    },
    {
      id: "period",
      labelKey: "watchlist_mood_period_label",
      noteKey: "watchlist_mood_period_note",
      items: pickAll(["movie:n-marble", "tv:n-still", "tv:n-lantern"]),
    },
    {
      id: "scifi",
      labelKey: "watchlist_mood_scifi_label",
      noteKey: "watchlist_mood_scifi_note",
      items: pickAll(["tv:n-gateway", "movie:n-hollow", "movie:n-sunset"]),
    },
    {
      id: "comedy",
      labelKey: "watchlist_mood_comedy_label",
      noteKey: "watchlist_mood_comedy_note",
      items: pickAll(["tv:after-party", "movie:t-2", "movie:t-4"]),
    },
    {
      id: "horror",
      labelKey: "watchlist_mood_horror_label",
      noteKey: "watchlist_mood_horror_note",
      items: pickAll(["tv:n-cinder", "tv:n-borderline"]),
    },
  ];
}

/**
 * Pre-formatted relative dates for the upcoming strip. Wired through
 * paraglide so the calendar reads naturally in any locale; mock-only.
 */
export function listMockUpcoming(): WatchlistItem[] {
  const labels = [
    m.watchlist_relative_tomorrow(),
    m.watchlist_relative_in_n_days({ n: "5" }),
    m.watchlist_relative_next_friday(),
    m.watchlist_relative_in_n_days({ n: "21" }),
  ];
  const upcomingIds = ["tv:drama-01", "tv:long-walk", "tv:halcyon", "tv:sovereigns"];
  return upcomingIds.map((id, i) => ({ ...pick(id)!, relDate: labels[i] }));
}

export function listMockRecentLog(): RecentLogEntry[] {
  const seeds: { id: string; added: string; source: string }[] = [
    {
      id: "movie:n-marble",
      added: m.watchlist_recent_added_hours_ago({ n: "2" }),
      source: m.watchlist_recent_source_recommended(),
    },
    {
      id: "tv:n-gateway",
      added: m.watchlist_recent_added_yesterday(),
      source: m.watchlist_recent_source_notification(),
    },
    {
      id: "movie:n-hollow",
      added: m.watchlist_recent_added_yesterday(),
      source: m.watchlist_recent_source_search(),
    },
    {
      id: "tv:long-walk",
      added: m.watchlist_recent_added_days_ago({ n: "3" }),
      source: m.watchlist_recent_source_trending(),
    },
    {
      id: "movie:n-ember",
      added: m.watchlist_recent_added_last_week(),
      source: m.watchlist_recent_source_friend(),
    },
  ];
  const out: RecentLogEntry[] = [];
  for (const seed of seeds) {
    const item = pick(seed.id);
    if (item) out.push({ item, added: seed.added, source: seed.source });
  }
  return out;
}
