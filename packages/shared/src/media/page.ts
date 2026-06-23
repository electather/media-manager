import type { CompactMediaItem } from "../home/types";

/**
 * Re-exported so client imports item and page envelope from one subpath.
 * Definition stays in @nama/shared/home to avoid churn cascade (design §A5).
 */
export type { CompactMediaItem } from "../home/types";

/**
 * Paginated result envelope (design §A5, V.WIRE1). Every media list source returns
 * this shape. Supersedes RowContentResponse, WatchlistResponse, WatchlistSectionResponse.
 * Bounded sources have cursor: null.
 */
export interface Page {
  items: CompactMediaItem[];
  cursor: string | null;
  partial: boolean;
}
