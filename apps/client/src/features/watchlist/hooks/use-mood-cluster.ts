import { useMediaRows } from "@/shared/media/use-media-rows";
import type { MoodId } from "@nama/shared/watchlist";
import { watchlistMoodItemsSource } from "../lib/sources";

/**
 * Paginated reader for a single mood cluster via `watchlist-mood-items` source.
 * Used by mood-mosaic preview (limit=3) and mood page (limit=60); `limit` rides params to keep caches distinct.
 */
export function useMoodCluster(moodId: MoodId, limit?: number) {
  return useMediaRows(watchlistMoodItemsSource(moodId, limit));
}
