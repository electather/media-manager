import type { WatchlistMoodSummary } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

// Watchlist mood summary read on unified media surface (design §A6/§B1).
// Not paginated: sits beside `defineMediaSource` fetcher, binds `api.media.*`,
// surfaces `MediaApiError` (#509); keys off `mediaKeys.moods()` (#505).
export async function fetchMoods(): Promise<WatchlistMoodSummary> {
  const res = await api.media.moods.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistMoodSummary;
}
