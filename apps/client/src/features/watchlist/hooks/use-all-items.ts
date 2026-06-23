import { useMediaRows } from "@/shared/media/use-media-rows";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@nama/shared/watchlist";
import { watchlistItemsSource } from "../lib/sources";

export interface UseAllItemsArgs {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

// Paginated reader for `watchlist-items` source backing `/watchlist/all`.
// Sort/bucket/mood ride source params for per-combo caching; no bespoke fetcher (design §B3).
export function useAllItems(args: UseAllItemsArgs = {}) {
  return useMediaRows(watchlistItemsSource(args));
}
