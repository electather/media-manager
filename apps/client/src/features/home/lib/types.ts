import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";

export type { RowKind };

export const MATCH_REASON_KEYS = [
  "matches_recent_picks",
  "from_genre_you_love",
  "similar_to_seed",
  "because_in_watchlist",
  "continuing_series",
  "upcoming_release",
  "recently_added",
  "highly_rated",
  "from_active_series",
  "finishing_soon",
] as const;

export type MatchReasonKey = (typeof MATCH_REASON_KEYS)[number];

/** Local UI-layer type extending the wire format with display fields absent from the API. */
export type HomeMediaItem = CompactMediaItem & {
  clearLogoText?: string;
  availability?: {
    hasAnyServerCopy: boolean;
    requestEligible: boolean;
    servers: { id: string; label: string }[];
  };
  seriesContext?: {
    season: number;
    episode: number;
    episodeTitle: string;
    nextUpFromServer: boolean;
  };
  facets?: {
    runtimeMin?: number;
    episodeCount?: number;
    monochrome?: boolean;
    releaseDate?: string;
  };
  /**
   * Maps from `CompactMediaItem.matchReason` at backend integration time.
   * Mock data sets this directly.
   */
  matchReasonKey?: MatchReasonKey;
  matchReasonParams?: Record<string, string>;
  tags?: string[];
  ageRating?: string;
  runtime?: string;
  trailerUrl?: string;
  relDate?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  cast?: string[];
  director?: string;
};

export type HeroItem = HomeMediaItem & { alternates: HomeMediaItem[] };

export type RowData = {
  id: string;
  kind: RowKind;
  seedTitle?: string;
  partial?: boolean;
  items: HomeMediaItem[];
  /** Derived client-side via ROW_ASPECT — not present in the wire format. */
  defaultAspect: "16/9" | "2/3";
};

/**
 * `hero` is `HeroItem | null`. In the mock phase the mock always supplies a hero;
 * `HomeFeed` treats `null` as an unrecoverable data error and throws via `invariant`.
 * At backend integration time `null` means the server had no suitable hero candidate —
 * `HomeFeed` should render the feed without a TopZone.
 */
export type HomeFeedData = { hero: HeroItem | null; rows: RowData[] };
