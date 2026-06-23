import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { MediaDetailsResponse } from "@nama/shared/home";
import { mediaKeys } from "@/shared/media/query-keys";
import { fetchHomeDetails } from "../lib/fetchers";
import { findCachedMediaItem } from "../lib/find-cached-item";

// Longer than the 60s default: title metadata extras barely change within a
// session, so a 10-min window keeps reopening the same detail modal instant.
const DETAILS_STALE_MS = 10 * 60 * 1000;

/**
 * Seeded with row/hero cache for instant summary render. Placeholder does NOT
 * satisfy cache — background fetch still runs and replaces it on success.
 * On plugin failure, `details: null` and `error.code` carries HostErrorCode.
 */
export function useHomeDetails(
  tmdbId: string | null,
  mediaType: "movie" | "tv" | null,
): UseQueryResult<MediaDetailsResponse, Error> {
  const queryClient = useQueryClient();
  return useQuery({
    // Derived from `mediaKeys.root` (invariant V.CL1); mirrors
    // `mediaKeys.title(type, tmdbId)` when both are set and stays stable
    // (disabled) while the modal is closed and both are null.
    queryKey: [...mediaKeys.root, "title", mediaType, tmdbId],
    queryFn: () => fetchHomeDetails(tmdbId!, mediaType!),
    enabled: tmdbId !== null && mediaType !== null,
    staleTime: DETAILS_STALE_MS,
    placeholderData: () => {
      if (!tmdbId || !mediaType) return undefined;
      const summary = findCachedMediaItem(queryClient, `${mediaType}:${tmdbId}`);
      return summary ? { summary, details: null } : undefined;
    },
  });
}
