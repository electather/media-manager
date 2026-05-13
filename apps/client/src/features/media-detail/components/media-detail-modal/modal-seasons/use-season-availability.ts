import { useSuspenseQuery, type UseSuspenseQueryResult } from "@tanstack/react-query";
import type { SeasonAvailabilityResponse } from "@ent-mcp/shared/home";

const SEASON_AVAILABILITY_STALE_MS = 5 * 60 * 1000;

async function fetchSeasonAvailability(
  tmdbId: string,
  signal: AbortSignal,
): Promise<SeasonAvailabilityResponse> {
  const params = new URLSearchParams({ tmdbId });
  const res = await fetch(`/api/home/season-availability?${params.toString()}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`home/season-availability ${tmdbId} ${res.status}`);
  return (await res.json()) as SeasonAvailabilityResponse;
}

/**
 * Suspense-mode `home.getSeasonAvailability` query. The 5-minute `staleTime`
 * mirrors the server-side `libraryAvailability@v1` capability cache so a
 * second open of the same modal lands warm.
 */
export function useSeasonAvailability(
  tmdbId: string,
): UseSuspenseQueryResult<SeasonAvailabilityResponse, Error> {
  return useSuspenseQuery({
    queryKey: ["home", "season-availability", tmdbId] as const,
    queryFn: ({ signal }) => fetchSeasonAvailability(tmdbId, signal),
    staleTime: SEASON_AVAILABILITY_STALE_MS,
  });
}
