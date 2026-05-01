import type { CompactMediaItem } from "../media/compact";
import type { HeroReason, RowKind } from "./enums";

export type { CompactMediaItem };

export interface LayoutHero {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  /** Server-resolved deep link for resume; null when no playable source available. */
  resumeUrl: string | null;
}

/** Row structure returned by `getLayout`. Contains no items — use `getRowContent` to load them. */
export interface HomeRowStub {
  rowId: RowKind;
  title: string;
  subtitle?: string;
  /** Cursor to pass as the first `getRowContent` call. Null means first page; non-null pins a seed (e.g. `becauseYouWatched`). */
  initialCursor: string | null;
}

export interface HomeLayoutResponse {
  hero: LayoutHero | null;
  rows: HomeRowStub[];
  /** Server clock at response assembly, ms epoch. */
  generatedAt: number;
}

export interface RowContentResponse {
  items: CompactMediaItem[];
  cursor: string | null;
  partial?: true;
}
