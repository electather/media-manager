import type { CompactMediaItem } from "../home/types";

/**
 * The one media item shape (`CompactMediaItem`) re-exported here so the client
 * imports the item and its page envelope from a single subpath. The definition
 * stays in `@nama/shared/home` to avoid a churn cascade (design §A5); this
 * is the canonical media-item home for new consumers.
 */
export type { CompactMediaItem } from "../home/types";

/**
 * The one paginated read result shape (design §A5, invariant V.WIRE1). Every
 * media list source — home rows, watchlist sections, bounded tonight/recently —
 * returns this envelope. It supersedes `RowContentResponse`,
 * `WatchlistResponse`, and `WatchlistSectionResponse`; bounded sources mint
 * `cursor: null`.
 */
export interface Page {
  items: CompactMediaItem[];
  cursor: string | null;
  partial: boolean;
}
