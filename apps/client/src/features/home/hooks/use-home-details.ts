import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MediaDetailsResponse } from "@ent-mcp/shared/home";
import { fetchHomeDetails } from "../lib/fetchers";
import { homeKeys } from "../lib/query-keys";

const DETAILS_STALE_MS = 10 * 60 * 1000;

/**
 * Live `home.getDetails` query. Returns the cached catalog summary plus the
 * live `metadata@v1.getDetails` extras; on plugin failure `details` is null
 * and `error.code` carries the HostErrorCode for retry copy.
 *
 * Disabled when no `tmdbId` is supplied — the modal calls this with the
 * peek id, which is null while the modal is closed. Stays on `useQuery`
 * (not the suspense variant) for that reason.
 */
export function useHomeDetails(
  tmdbId: string | null,
  mediaType: "movie" | "tv" | null,
): UseQueryResult<MediaDetailsResponse, Error> {
  return useQuery({
    queryKey: homeKeys.details(tmdbId, mediaType),
    queryFn: () => fetchHomeDetails(tmdbId!, mediaType!),
    enabled: tmdbId !== null && mediaType !== null,
    staleTime: DETAILS_STALE_MS,
  });
}
