import type * as messages from "@/paraglide/messages";
import type {
  Availability,
  CompactMediaItem,
  Facets,
  HeroReason,
  RowKind,
  SeriesContext,
} from "@nama/shared/home";
import type { MediaSourceId } from "@nama/shared/media";

export type { RowKind };

/** Valid Paraglide message key. Narrows `string` to the keys exported by `@/paraglide/messages`. */
export type MessageKey = keyof typeof messages;

/** Wire shape plus UI-only fields like `clearLogoText`. Mock-era `seasons[]` and `MatchReason` shim removed in PR6 once home backend shipped typed wire. */
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
  seasons?: import("@nama/shared/home").SeasonInfo[];
};

export type { Availability, Facets, SeriesContext };

/** Flattens slide.item + slide-level metadata for carousel. `resumeUrl` always null v1 — Play navigates to detail instead of resuming. */
export type HeroSlideUI = HomeMediaItem & {
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
};

export type RowData = {
  /** Stable wire slug — the `sourceId` for `/api/media/sources/:sourceId`. */
  id: MediaSourceId;
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
