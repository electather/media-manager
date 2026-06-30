import type * as messages from "@/paraglide/messages";
import type { CompactMediaItem, HeroReason, MediaDetailsExtra, RowKind } from "@nama/shared/home";
import type { MediaSourceId } from "@nama/shared/media";

/** Valid Paraglide message key. Narrows `string` to the keys exported by `@/paraglide/messages`. */
export type MessageKey = keyof typeof messages;

/** Card image ratio: `16/9` backdrop rail vs `2/3` poster grid. Derived client-side via `ROW_ASPECT` — not in the wire format. */
export type RowAspect = "16/9" | "2/3";

/** Wire shape plus the `MediaDetailsExtra` fields the modal layers in via `useHomeDetails` (all optional here) and UI-only `clearLogoText`. */
export type HomeMediaItem = CompactMediaItem &
  Partial<MediaDetailsExtra> & {
    clearLogoText?: string;
  };

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
  defaultAspect: RowAspect;
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
