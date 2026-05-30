import { useMediaRows } from "@/shared/media/use-media-rows";
import { watchlistRecentlySource } from "../lib/sources";

const STALE_TIME_MS = 60_000;
const DEFAULT_LIMIT = 5;

/**
 * Reader for the recently-added strip via the `watchlist-recently` media
 * source. Capped at five rows by default so the strip stays a strip — the
 * source returns a bounded page with no cursor.
 */
export function useRecentlyAdded(limit: number = DEFAULT_LIMIT) {
  return useMediaRows(watchlistRecentlySource(limit), { staleTime: STALE_TIME_MS });
}
