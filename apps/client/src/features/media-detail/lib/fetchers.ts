import type { SeasonAvailabilityResponse } from "@nama/shared/home";
import { api } from "@/shared/lib/api";
import { throwOnError } from "@/shared/media/error";

/**
 * Fetches season availability for a TV title. Routes through the unified media
 * title resource (§A8 cutover); the old `/home/season-availability` endpoint
 * was deleted. Season availability is a TV-only concern, so `:type` is always
 * `tv` (the composer ignores it).
 */
export async function fetchSeasonAvailability(
  tmdbId: string,
  signal: AbortSignal,
): Promise<SeasonAvailabilityResponse> {
  const res = await api.media[":type"][":tmdbId"].availability.$get(
    { param: { type: "tv", tmdbId } },
    { init: { signal } },
  );
  // Surface the same `MediaApiError` envelope the ErrorBoundaries key retry
  // copy off (V.CL1); a raw `Error` would fall through to the generic branch
  // and show the URL string instead of the localized server message.
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as SeasonAvailabilityResponse;
}
