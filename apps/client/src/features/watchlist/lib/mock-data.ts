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

type Seed = {
  id: string;
  title: string;
  mediaType: "movie" | "tv";
  year?: number;
  rating?: number;
  runtimeMin?: number;
  episodeCount?: number;
  releaseDate?: string;
  status?: "available" | "requested" | "unavailable";
  clearLogoText?: string;
  genres?: string[];
  matchReasonText?: string;
  progress?: { watched: number; total: number };
};

// fallow-ignore-next-line complexity
function buildFacets(seed: Seed): WatchlistItem["facets"] | undefined {
  if (seed.runtimeMin === undefined && seed.episodeCount === undefined && !seed.releaseDate)
    return undefined;
  return {
    ...(seed.runtimeMin !== undefined && { runtimeMin: seed.runtimeMin }),
    ...(seed.episodeCount !== undefined && { episodeCount: seed.episodeCount }),
    ...(seed.releaseDate && { releaseDate: seed.releaseDate }),
  };
}

/**
 * Builds a `WatchlistItem` from a compact seed. Centralising the construction
 * here removes the structural duplication fallow flagged across the per-item
 * literals while still keeping the seeds readable.
 */
// fallow-ignore-next-line complexity
function build(seed: Seed): WatchlistItem {
  const tmdbId = seed.id.split(":")[1] ?? seed.id;
  const facets = buildFacets(seed);
  return {
    id: seed.id,
    tmdbId,
    mediaType: seed.mediaType,
    title: seed.title,
    poster: img(`${tmdbId}-poster`, 600, 900),
    backdrop: img(`${tmdbId}-bd`, 1600, 900),
    ...(seed.year !== undefined && { year: seed.year }),
    ...(seed.rating !== undefined && { rating: seed.rating }),
    ...(seed.genres && { genres: seed.genres }),
    ...(seed.status && { status: seed.status }),
    ...(seed.clearLogoText && { clearLogoText: seed.clearLogoText }),
    ...(seed.matchReasonText && { matchReasonText: seed.matchReasonText }),
    ...(seed.progress && { progress: seed.progress }),
    ...(facets && { facets }),
  };
}

const SEEDS: readonly Seed[] = [
  {
    id: "movie:n-marble",
    title: "Marble Halls",
    mediaType: "movie",
    year: 2021,
    rating: 7.9,
    runtimeMin: 124,
    clearLogoText: "MARBLE·HALLS",
    genres: ["Drama", "Period"],
    matchReasonText:
      "Quiet, deliberate. Fits a long evening with no interruptions, the way you watched 'Aurora Drift'.",
  },
  {
    id: "movie:n-blue-hour",
    title: "Blue Hour",
    mediaType: "movie",
    year: 2022,
    rating: 8.1,
    runtimeMin: 108,
    clearLogoText: "BLUE·HOUR",
    genres: ["Drama"],
    progress: { watched: 38, total: 100 },
  },
  {
    id: "movie:n-water-lily",
    title: "Water Lily",
    mediaType: "movie",
    year: 2020,
    rating: 7.6,
    runtimeMin: 96,
    genres: ["Drama"],
    status: "available",
  },
  {
    id: "tv:n-portal",
    title: "Portal Echoes",
    mediaType: "tv",
    year: 2024,
    rating: 8.4,
    runtimeMin: 52,
    episodeCount: 8,
    clearLogoText: "PORTAL·ECHOES",
    genres: ["Sci-Fi", "Drama"],
  },
  {
    id: "tv:n-gateway",
    title: "The Gateway",
    mediaType: "tv",
    year: 2024,
    rating: 8.7,
    runtimeMin: 48,
    episodeCount: 10,
    genres: ["Sci-Fi", "Mystery"],
    status: "available",
  },
  {
    id: "movie:n-sunset",
    title: "Sunset Frequency",
    mediaType: "movie",
    year: 2023,
    rating: 7.4,
    runtimeMin: 119,
    genres: ["Sci-Fi"],
  },
  {
    id: "movie:n-hollow",
    title: "Hollow Light",
    mediaType: "movie",
    year: 2024,
    rating: 7.9,
    runtimeMin: 132,
    genres: ["Sci-Fi", "Drama"],
  },
  {
    id: "tv:after-party",
    title: "After Party",
    mediaType: "tv",
    year: 2023,
    rating: 8.0,
    runtimeMin: 28,
    episodeCount: 12,
    genres: ["Comedy"],
  },
  {
    id: "tv:n-lantern",
    title: "Lantern Court",
    mediaType: "tv",
    year: 2022,
    rating: 8.3,
    runtimeMin: 55,
    episodeCount: 8,
    genres: ["Period", "Drama"],
  },
  {
    id: "movie:t-2",
    title: "Tessellate",
    mediaType: "movie",
    year: 2023,
    rating: 7.2,
    runtimeMin: 102,
    genres: ["Comedy"],
  },
  {
    id: "movie:t-4",
    title: "Plain Sailing",
    mediaType: "movie",
    year: 2022,
    rating: 6.8,
    runtimeMin: 91,
    genres: ["Comedy"],
  },
  {
    id: "movie:t-7",
    title: "Quiet Quarter",
    mediaType: "movie",
    year: 2024,
    rating: 7.7,
    runtimeMin: 116,
    genres: ["Thriller"],
  },
  {
    id: "movie:n-ember",
    title: "Ember Light",
    mediaType: "movie",
    year: 2023,
    runtimeMin: 105,
    genres: ["Drama"],
    status: "requested",
  },
  {
    id: "movie:n-tessera",
    title: "Tessera",
    mediaType: "movie",
    year: 2024,
    runtimeMin: 110,
    genres: ["Drama"],
    status: "requested",
  },
  {
    id: "tv:n-quartz",
    title: "Quartz",
    mediaType: "tv",
    year: 2024,
    runtimeMin: 50,
    episodeCount: 6,
    genres: ["Mystery"],
    status: "unavailable",
  },
  {
    id: "movie:n-northwind",
    title: "Northwind",
    mediaType: "movie",
    year: 2022,
    runtimeMin: 138,
    genres: ["Adventure"],
    status: "unavailable",
  },
  {
    id: "tv:n-cinder",
    title: "Cinder",
    mediaType: "tv",
    year: 2023,
    runtimeMin: 44,
    episodeCount: 8,
    genres: ["Horror"],
    status: "unavailable",
  },
  {
    id: "tv:n-borderline",
    title: "Borderline",
    mediaType: "tv",
    year: 2024,
    runtimeMin: 52,
    episodeCount: 6,
    genres: ["Horror", "Mystery"],
    status: "unavailable",
  },
  {
    id: "tv:drama-01",
    title: "The Long Hour",
    mediaType: "tv",
    year: 2026,
    runtimeMin: 50,
    episodeCount: 8,
    releaseDate: "2026-05-12",
    genres: ["Drama"],
  },
  {
    id: "tv:long-walk",
    title: "Long Walk Home",
    mediaType: "tv",
    year: 2026,
    runtimeMin: 52,
    episodeCount: 6,
    releaseDate: "2026-05-22",
    genres: ["Drama"],
  },
  {
    id: "tv:halcyon",
    title: "Halcyon",
    mediaType: "tv",
    year: 2026,
    runtimeMin: 48,
    episodeCount: 10,
    releaseDate: "2026-06-01",
    genres: ["Sci-Fi"],
  },
  {
    id: "tv:sovereigns",
    title: "Sovereigns",
    mediaType: "tv",
    year: 2026,
    runtimeMin: 55,
    episodeCount: 8,
    releaseDate: "2026-06-14",
    genres: ["Period", "Drama"],
  },
  {
    id: "tv:n-meridian",
    title: "Meridian",
    mediaType: "tv",
    year: 2023,
    rating: 7.8,
    runtimeMin: 50,
    episodeCount: 6,
    genres: ["Drama"],
  },
  {
    id: "tv:n-anchor",
    title: "Anchor Point",
    mediaType: "tv",
    year: 2024,
    rating: 8.1,
    runtimeMin: 48,
    episodeCount: 8,
    genres: ["Thriller"],
  },
  {
    id: "tv:n-ledger",
    title: "The Ledger",
    mediaType: "tv",
    year: 2023,
    rating: 7.9,
    runtimeMin: 52,
    episodeCount: 8,
    genres: ["Thriller"],
  },
  {
    id: "tv:n-still",
    title: "Still Lives",
    mediaType: "tv",
    year: 2022,
    rating: 8.0,
    runtimeMin: 50,
    episodeCount: 6,
    genres: ["Period"],
  },
];

const ITEMS: readonly WatchlistItem[] = SEEDS.map(build);
const ID_INDEX = new Map(ITEMS.map((it) => [it.id, it] as const));

export function listMockWatchlist(): readonly WatchlistItem[] {
  return ITEMS;
}

function pickAll(ids: readonly string[]): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const id of ids) {
    const it = ID_INDEX.get(id);
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
  const seeds: { id: string; label: string }[] = [
    { id: "tv:drama-01", label: m.watchlist_relative_tomorrow() },
    { id: "tv:long-walk", label: m.watchlist_relative_in_n_days({ n: "5" }) },
    { id: "tv:halcyon", label: m.watchlist_relative_next_friday() },
    { id: "tv:sovereigns", label: m.watchlist_relative_in_n_days({ n: "21" }) },
  ];
  const out: WatchlistItem[] = [];
  for (const { id, label } of seeds) {
    const item = ID_INDEX.get(id);
    if (item) out.push({ ...item, relDate: label });
  }
  return out;
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
    const item = ID_INDEX.get(seed.id);
    if (item) out.push({ item, added: seed.added, source: seed.source });
  }
  return out;
}
