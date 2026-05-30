import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { SeasonAvailabilityResponse } from "@ent-mcp/shared/home";
import { api } from "@/shared/lib/api";

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
  if (!res.ok) throw new Error(`media/availability ${tmdbId} ${res.status}`);
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
    queryKey: ["media", "season-availability", tmdbId] as const,
    queryFn: ({ signal }) => fetchSeasonAvailability(tmdbId, signal),
    staleTime: SEASON_AVAILABILITY_STALE_MS,
  });
}
