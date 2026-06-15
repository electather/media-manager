import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { SeasonAvailabilityResponse } from "@nama/shared/home";
import { mediaKeys } from "@/shared/media/query-keys";
import { fetchSeasonAvailability } from "@/features/media-detail/lib/fetchers";

const SEASON_AVAILABILITY_STALE_MS = 5 * 60 * 1000;

/**
 * Suspense-mode season-availability query. The 5-minute `staleTime` mirrors the
 * server-side `libraryAvailability@v1` capability cache so a second open of the
 * same modal lands warm.
 */
export function useSeasonAvailability(
  tmdbId: string,
): UseSuspenseQueryResult<SeasonAvailabilityResponse, Error> {
  return useSuspenseQuery({
    queryKey: mediaKeys.seasonAvailability(tmdbId),
    queryFn: ({ signal }) => fetchSeasonAvailability(tmdbId, signal),
    staleTime: SEASON_AVAILABILITY_STALE_MS,
  });
}
