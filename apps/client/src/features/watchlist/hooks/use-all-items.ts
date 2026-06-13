import { useMediaRows } from "@/shared/media/use-media-rows";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@nama/shared/watchlist";
import { watchlistItemsSource } from "../lib/sources";

const STALE_TIME_MS = 60_000;

export interface UseAllItemsArgs {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Paginated reader for the `watchlist-items` media source. Backs the flat
 * `/watchlist/all` view; sort/bucket/mood ride the source params so each
 * combination has its own cache. Reads through the shared media layer
 * (`api.media.sources/watchlist-items`) — no bespoke fetcher (design §B3).
 */
export function useAllItems(args: UseAllItemsArgs = {}) {
  return useMediaRows(watchlistItemsSource(args), { staleTime: STALE_TIME_MS });
}
