import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MediaDetailsResponse } from "@ent-mcp/shared/home";

const DETAILS_STALE_MS = 10 * 60 * 1000;

async function fetchDetails(
  tmdbId: string,
  mediaType: "movie" | "tv",
  signal: AbortSignal,
): Promise<MediaDetailsResponse> {
  const params = new URLSearchParams({ tmdbId, mediaType });
  const res = await fetch(`/api/home/details?${params.toString()}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`home/details ${tmdbId} ${res.status}`);
  return (await res.json()) as MediaDetailsResponse;
}

/**
 * Live `home.getDetails` query. Returns the cached catalog summary plus the
 * live `metadata@v1.getDetails` extras; on plugin failure `details` is null
 * and `error.code` carries the HostErrorCode for retry copy.
 *
 * Disabled when no `tmdbId` is supplied — the modal calls this with the
 * peek id, which is null while the modal is closed.
 */
export function useHomeDetails(
  tmdbId: string | null,
  mediaType: "movie" | "tv" | null,
): UseQueryResult<MediaDetailsResponse, Error> {
  return useQuery({
    queryKey: ["home", "details", tmdbId, mediaType] as const,
    queryFn: ({ signal }) => fetchDetails(tmdbId!, mediaType!, signal),
    enabled: tmdbId !== null && mediaType !== null,
    staleTime: DETAILS_STALE_MS,
  });
}
