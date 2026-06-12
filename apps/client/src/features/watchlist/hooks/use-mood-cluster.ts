import { useMediaRows } from "@/shared/media/use-media-rows";
import type { MoodId } from "@nama/shared/watchlist";
import { watchlistMoodItemsSource } from "../lib/sources";

const STALE_TIME_MS = 60_000;

/**
 * Paginated reader for a single mood cluster via the `watchlist-mood-items`
 * media source. Used by both the mood-mosaic preview (limit=3) and the
 * dedicated mood page (limit=60); `limit` rides the source params so the two
 * caches stay distinct.
 */
export function useMoodCluster(moodId: MoodId, limit?: number) {
  return useMediaRows(watchlistMoodItemsSource(moodId, limit), { staleTime: STALE_TIME_MS });
}
