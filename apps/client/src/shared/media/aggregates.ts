import type { WatchlistMoodSummary } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

/**
 * The watchlist mood summary read on the unified media surface (design §A6/§B1).
 * It is not a paginated list, so it sits beside the `defineMediaSource` list
 * fetcher rather than going through it — it still binds `api.media.*` and
 * surfaces `MediaApiError`, keeping every watchlist read on one client layer
 * (#509). It keys off `mediaKeys.moods()` so the one-shot `mediaKeys.root`
 * mutation sweep flushes it too (#505).
 */
export async function fetchMoods(): Promise<WatchlistMoodSummary> {
  const res = await api.media.moods.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistMoodSummary;
}
