import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { SeasonAvailabilityResponse } from "@nama/shared/home";
import { api } from "@/shared/lib/api";
import { throwOnError } from "@/shared/media/error";
import { mediaKeys } from "@/shared/media/query-keys";

const SEASON_AVAILABILITY_STALE_MS = 5 * 60 * 1000;

async function fetchSeasonAvailability(
  tmdbId: string,
  signal: AbortSignal,
): Promise<SeasonAvailabilityResponse> {
  // Routes through the unified media title resource (§A8 cutover); the old
  // `/home/season-availability` endpoint was deleted. Season availability is a
  // TV-only concern, so `:type` is always `tv` (the composer ignores it).
  const res = await api.media[":type"][":tmdbId"].availability.$get(
    { param: { type: "tv", tmdbId } },
    { init: { signal } },
  );
  // Surface the same `MediaApiError` envelope the ErrorBoundaries key retry copy
  // off (V.CL1); a raw `Error` would fall through to the generic branch and show
  // the URL string instead of the localized server message.
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as SeasonAvailabilityResponse;
}

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
