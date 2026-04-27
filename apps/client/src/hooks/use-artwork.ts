import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import { api } from "@/lib/api";

/**
 * Empty bundle returned while a real fetch is in flight, on error, or for
 * items the server could not resolve. Stable reference so consumers can
 * treat fallbacks deterministically without `?? EMPTY` guards everywhere.
 */
export const EMPTY_BUNDLE: ArtworkBundle = Object.freeze({
  poster: [],
  backdrop: [],
  clearLogo: [],
  thumb: [],
}) as ArtworkBundle;

export const artworkQueryKey = (key: string) => ["artwork", key] as const;

async function fetchOne(item: ArtworkRequestItem): Promise<ArtworkBundle> {
  const res = await api.artwork.get.$post({ json: { items: [item] } });
  if (!res.ok) throw new Error(`artwork.get failed: HTTP ${res.status}`);
  const data = (await res.json()) as { results: Record<string, ArtworkBundle> };
  return data.results[item.key] ?? EMPTY_BUNDLE;
}

export interface UseArtworkOptions {
  /**
   * Skip the fetch entirely while false. Wired by the caller to viewport
   * intersection so cards below the fold don't compete with above-fold
   * cards for the browser's HTTP/1.1 connection budget in dev.
   */
  enabled?: boolean;
}

/**
 * Fetches artwork for a single media item. One POST per call — tanstack-query
 * deduplicates by `queryKey`, so two `useArtwork` calls with the same `key`
 * still result in a single in-flight request. Resolves to `EMPTY_BUNDLE` on
 * failure so consumers always get a stable shape.
 */
export function useArtwork(
  item: ArtworkRequestItem,
  opts: UseArtworkOptions = {},
): UseQueryResult<ArtworkBundle> {
  return useQuery({
    queryKey: artworkQueryKey(item.key),
    queryFn: () => fetchOne(item),
    enabled: opts.enabled ?? true,
    // Artwork is shared across users (capability scope = global) and rarely
    // changes, so a long client-side stale window keeps fan-out small as the
    // user scrolls back through rows already rendered once.
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    retry: 1,
  });
}
