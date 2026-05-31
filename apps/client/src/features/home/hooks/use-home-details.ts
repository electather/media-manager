import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { MediaDetailsResponse } from "@ent-mcp/shared/home";
import { mediaKeys } from "@/shared/media/query-keys";
import { fetchHomeDetails } from "../lib/fetchers";
import { findCachedMediaItem } from "../lib/find-cached-item";

const DETAILS_STALE_MS = 10 * 60 * 1000;

/**
 * Live `home.getDetails` query. Returns the cached catalog summary plus the
 * live `metadata@v1.getDetails` extras; on plugin failure `details` is null
 * and `error.code` carries the HostErrorCode for retry copy.
 *
 * Disabled when no `tmdbId` is supplied — the modal calls this with the
 * peek id, which is null while the modal is closed. Stays on `useQuery`
 * (not the suspense variant) for that reason.
 *
 * `placeholderData` seeds the response from row / hero caches so the
 * modal can render summary fields instantly while the rich fetch is still
 * in flight. The placeholder does NOT satisfy the cache — TanStack Query
 * still runs `fetchHomeDetails` in the background and replaces the
 * placeholder with the full payload (including `details`) on success.
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
