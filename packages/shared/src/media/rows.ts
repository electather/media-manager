import type { WatchlistSource } from "../watchlist/enums";
import type { MediaType } from "./enums";

export const ROW_SORTS = ["recentDesc", "recentAsc"] as const;
export type RowSort = (typeof ROW_SORTS)[number];

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
  source: WatchlistSource;
  addedAt: number;
  removedAt: number | null;
  seeded: boolean;
}
