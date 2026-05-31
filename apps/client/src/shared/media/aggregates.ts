import type { WatchlistCounts, WatchlistMoodSummary } from "@ent-mcp/shared/media";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

/**
 * The watchlist aggregate reads on the unified media surface (design §A6/§B1).
 * Counts and the mood summary are not paginated lists, so they sit beside the
 * `defineMediaSource` list fetcher rather than going through it — both still
 * bind `api.media.*` and surface `MediaApiError`, keeping every watchlist read
 * on one client layer once `lib/fetchers.ts` is gone (#509). They key off
 * `mediaKeys.counts()` / `mediaKeys.moods()` so the one-shot `mediaKeys.root`
 * mutation sweep flushes them too (#505).
 */
export async function fetchCounts(): Promise<WatchlistCounts> {
  const res = await api.media.counts.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistCounts;
}

export async function fetchMoods(): Promise<WatchlistMoodSummary> {
  const res = await api.media.moods.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistMoodSummary;
}
