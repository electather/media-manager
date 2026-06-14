import { useSuspenseQuery } from "@tanstack/react-query";
import { mediaKeys } from "@/shared/media/query-keys";
import { fetchMoods } from "@/shared/media/aggregates";

/**
 * Suspense-driven read of `/api/media/moods`. Returns the mood-summary cluster
 * counts. Mood-cluster previews use `useMoodCluster(id, limit)` separately.
 */
export function useMoods() {
  return useSuspenseQuery({
    queryKey: mediaKeys.moods(),
    queryFn: fetchMoods,
  });
}
