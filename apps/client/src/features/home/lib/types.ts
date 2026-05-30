import type * as messages from "@/paraglide/messages";
import type {
  Availability,
  CompactMediaItem,
  Facets,
  HeroReason,
  RowKind,
  SeriesContext,
} from "@ent-mcp/shared/home";

export type { RowKind };

/** Valid Paraglide message key. Narrows `string` to the keys exported by `@/paraglide/messages`. */
export type MessageKey = keyof typeof messages;

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

/**
 * Local UI-layer projection of `CompactMediaItem`. Re-exposes the wire fields
 * the cards/hero render and adds display-only scaffolding the API does not
 * provide (e.g. `clearLogoText`). The mock-era `seasons[]` field, the
 * `facets.monochrome` shadcn helper, and the prose `MatchReason` shim were
 * removed in PR6 once the home backend started shipping the typed wire
 * shape end-to-end.
 */
export type HomeMediaItem = CompactMediaItem & {
  clearLogoText?: string;
  /** Subset of `MediaDetailsExtra` the modal layers in via `useHomeDetails`. */
  ageRating?: string;
  runtime?: string;
  trailerUrl?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  cast?: string[];
  director?: string;
  seriesStatus?: "ongoing" | "finished";
  nextAirDate?: string;
  seasons?: import("@ent-mcp/shared/home").SeasonInfo[];
};

export type { Availability, Facets, SeriesContext };

/**
 * Per-slide UI projection of a `HeroSlide`. Flattens `slide.item` into the
 * card shape the existing top-zone renderer expects and stamps the slide-
 * level metadata (`source`, `reason`, `resumeUrl`) so the carousel can show
 * a per-slide source label and pick a Play CTA. `resumeUrl` is always `null`
 * v1 — Play renders as nav-to-detail.
 */
export type HeroSlideUI = HomeMediaItem & {
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
};

export type RowData = {
  /** Stable wire slug (a `MediaSourceId`) — the `sourceId` for `/api/media/sources/:sourceId`. */
  id: string;
  kind: RowKind;
  seedTitle?: string;
  /** Cursor to pass on the first row fetch (non-null for seeded rows). */
  initialCursor: string | null;
  /** Derived client-side via ROW_ASPECT — not present in the wire format. */
  defaultAspect: "16/9" | "2/3";
  /**
   * Optional UI-only header override. When two rows share the same `kind`
   * (e.g. two `continueWatching` rows representing different intents), pass
   * a distinct Paraglide message key so the headings stay readable.
   */
  headerKey?: MessageKey;
  /** Optional subtitle override paired with `headerKey`. */
  eyebrowKey?: MessageKey;
};

/**
 * `heroSlides` is empty when the server had no suitable hero candidate
 * (`LayoutHero === null`); otherwise it is a 1–6 entry list iterated by the
 * top-zone carousel. `slides[0]` is the lead/auto-shown.
 */
export type HomeFeedData = { heroSlides: HeroSlideUI[]; rows: RowData[] };
