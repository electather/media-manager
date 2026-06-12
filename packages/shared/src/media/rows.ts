import type { WatchlistSource } from "../watchlist/enums";
import type { MediaType } from "./enums";

export const ROW_SORTS = ["recentDesc", "recentAsc"] as const;
export type RowSort = (typeof ROW_SORTS)[number];

/** Source values a persistent active row can carry. Superset of watchlist-specific sources. */
export type RowSource = WatchlistSource;

export interface RowFilter {
  mediaType?: MediaType;
  state?: "active" | "removed";
}

export interface ActiveRow {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: MediaType;
  state: "active" | "removed";
  source: RowSource;
  addedAt: number;
  removedAt: number | null;
  seeded: boolean;
}
