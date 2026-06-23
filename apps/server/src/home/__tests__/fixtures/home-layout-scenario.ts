import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";
import type { MediaType } from "@nama/shared/media";

/**
 * Deterministic parity test (design §T, RISK-103). Proves US-020..US-022
 * MediaSource migration is behavior-neutral. No wall-clock dependency.
 */
export const PARITY_USER_ID = "home-parity-user";

/** Minimal library-item shape the continue-watching + calendar adapters probe. */
interface ScenarioLibraryItem {
  ids: { tmdb: string };
  type: "movie" | "show" | "episode";
  title: string;
  durationSec?: number;
  season?: number;
  episode?: number;
}

function libItem(opts: {
  tmdbId: string;
  type: ScenarioLibraryItem["type"];
  title: string;
  durationSec?: number;
  season?: number;
  episode?: number;
}): ScenarioLibraryItem {
  return {
    ids: { tmdb: opts.tmdbId },
    type: opts.type,
    title: opts.title,
    ...(opts.durationSec !== undefined ? { durationSec: opts.durationSec } : {}),
    ...(opts.season !== undefined ? { season: opts.season } : {}),
    ...(opts.episode !== undefined ? { episode: opts.episode } : {}),
  };
}

export interface ScenarioContinueWatchingEntry {
  item: ScenarioLibraryItem;
  progressMs?: number;
  lastPlayedAt?: string;
  nextUp?: ScenarioLibraryItem;
}

/**
 * One feed serves continue-watching rows + hero pool. `cwa1`/`cwa2` have active
 * progress (ratio < 0.85), `cwn1`/`cwn2` are finished/empty (ratio ≥ 0.95 or
 * no progress); `cwn1` ships a server `nextUp` episode.
 */
export const CONTINUE_WATCHING_FEED: ScenarioContinueWatchingEntry[] = [
  {
    item: libItem({ tmdbId: "cwa1", type: "movie", title: "CW Active One", durationSec: 6000 }),
    progressMs: 600_000,
    lastPlayedAt: "2026-05-05T00:00:00Z",
  },
  {
    item: libItem({ tmdbId: "cwa2", type: "movie", title: "CW Active Two", durationSec: 6000 }),
    progressMs: 3_000_000,
    lastPlayedAt: "2026-05-03T00:00:00Z",
  },
  {
    item: libItem({
      tmdbId: "cwn1",
      type: "show",
      title: "CW Next One",
      durationSec: 6000,
      season: 1,
      episode: 1,
    }),
    progressMs: 5_700_000,
    lastPlayedAt: "2026-05-04T00:00:00Z",
    nextUp: libItem({ tmdbId: "cwn1", type: "episode", title: "Up Next", season: 1, episode: 2 }),
  },
  {
    item: libItem({ tmdbId: "cwn2", type: "show", title: "CW Next Two", season: 1, episode: 1 }),
    lastPlayedAt: "2026-05-02T00:00:00Z",
  },
];

/** Day-bucketed discovery snapshots (`getDiscoverFeed`) for trending + new releases. */
export const TRENDING_SNAPSHOT: MetadataKey[] = [
  { tmdbId: "tr1", type: "movie" },
  { tmdbId: "tr2", type: "tv" },
  { tmdbId: "tr3", type: "movie" },
];

export const NEW_RELEASES_SNAPSHOT: MetadataKey[] = [
  { tmdbId: "nr1", type: "movie" },
  { tmdbId: "nr2", type: "movie" },
];

export interface ScenarioRecommendation {
  tmdbId: string;
  mediaType: MediaType;
  matchReason: null;
  topContributors: never[];
  score: number;
}

/** `getRecommendations(userId, "default")` — two movies then two tv titles. */
export const RECOMMENDATIONS = {
  items: [
    { tmdbId: "rm1", mediaType: "movie", matchReason: null, topContributors: [], score: 0.9 },
    { tmdbId: "rm2", mediaType: "movie", matchReason: null, topContributors: [], score: 0.8 },
    { tmdbId: "rt1", mediaType: "tv", matchReason: null, topContributors: [], score: 0.7 },
    { tmdbId: "rt2", mediaType: "tv", matchReason: null, topContributors: [], score: 0.6 },
  ] satisfies ScenarioRecommendation[],
  profileVersion: 1,
  generatedAt: 0,
};

/** History seed for becauseYouWatched (`getUserHistory`); single entry → fixed seed. */
export const SEED_TMDB_ID = "seed1";
export const SEED_MEDIA_TYPE: MediaType = "movie";

export const USER_HISTORY = [
  {
    tmdbId: SEED_TMDB_ID,
    mediaType: SEED_MEDIA_TYPE,
    watchedAt: Date.parse("2026-04-01T00:00:00Z"),
    sourceConnectionId: "c1",
    episodeKey: null,
    progress: null,
  },
];

/** `getSimilarFeed` candidates for the becauseYouWatched seed. */
export const SIMILAR_FEED = {
  items: [
    libItem({ tmdbId: "sim1", type: "movie", title: "Similar One" }),
    libItem({ tmdbId: "sim2", type: "movie", title: "Similar Two" }),
  ],
  partial: false,
};

/** `getUpcomingFeed` calendar entries (Trakt-style `{ item, airsAt }` wrap). */
export const UPCOMING_FEED = {
  items: [
    {
      airDate: "2026-06-01T20:00:00Z",
      airsAt: "2026-06-01T20:00:00Z",
      item: libItem({ tmdbId: "up1", type: "show", title: "Upcoming One", season: 1, episode: 2 }),
    },
    {
      airDate: "2026-06-02T20:00:00Z",
      airsAt: "2026-06-02T20:00:00Z",
      item: libItem({ tmdbId: "up2", type: "show", title: "Upcoming Two", season: 1, episode: 3 }),
    },
  ],
  partial: false,
};

/** `watchlist.listAvailable` result for the yourWatchlist row (already enriched). */
export const WATCHLIST_AVAILABLE = {
  items: [
    {
      id: "movie:wl1",
      tmdbId: "wl1",
      mediaType: "movie" as const,
      title: "Watchlist One",
      addedAt: 100,
      addedSource: "manual" as const,
    },
    {
      id: "tv:wl2",
      tmdbId: "wl2",
      mediaType: "tv" as const,
      title: "Watchlist Two",
      addedAt: 200,
      addedSource: "plugin" as const,
    },
  ],
  cursor: null,
  partial: false,
};

function metaFor(tmdbId: string, mediaType: MediaType, title: string): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title,
    year: 2024,
    runtimeMinutes: 100,
    // Artwork URLs present so `enrich` would short-circuit artwork hydration;
    // the parity test mocks `enrichCompactItems` to a pass-through, so these
    // never matter to the asserted ids, but keep the fixture realistic.
    posterUrl: `https://art.test/${tmdbId}/poster.jpg`,
    backdropUrl: `https://art.test/${tmdbId}/backdrop.jpg`,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: "en",
    genres: null,
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

/**
 * Metadata for catalog-backed keys (trending, new releases, recommendations,
 * similar, upcoming). Continue-watching + watchlist build from feeds directly,
 * so their ids are absent here by design.
 */
export function buildScenarioMetadata(): Record<string, CanonicalMetadata> {
  const entries: [string, MediaType, string][] = [
    ["tr1", "movie", "Trending One"],
    ["tr2", "tv", "Trending Two"],
    ["tr3", "movie", "Trending Three"],
    ["nr1", "movie", "New Release One"],
    ["nr2", "movie", "New Release Two"],
    ["rm1", "movie", "Recommended Movie One"],
    ["rm2", "movie", "Recommended Movie Two"],
    ["rt1", "tv", "Recommended Show One"],
    ["rt2", "tv", "Recommended Show Two"],
    ["sim1", "movie", "Similar One"],
    ["sim2", "movie", "Similar Two"],
    ["up1", "tv", "Upcoming One"],
    ["up2", "tv", "Upcoming Two"],
  ];
  const out: Record<string, CanonicalMetadata> = {};
  for (const [tmdbId, mediaType, title] of entries) {
    out[`${mediaType}:${tmdbId}`] = metaFor(tmdbId, mediaType, title);
  }
  return out;
}

/** Seed metadata (`getMetadata`) so becauseYouWatched can stamp `seedTitle`. */
export function buildSeedMetadata(): CanonicalMetadata {
  return metaFor(SEED_TMDB_ID, SEED_MEDIA_TYPE, "Seed One");
}
