import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import { api } from "@/lib/api";

export type ArtworkSlot = "poster" | "backdrop" | "clearLogo";

/**
 * Subset of `CompactMediaItem` the client uses for the slot-aware artwork
 * lookup. Only the URL fields the inline write-back path can fill are
 * declared here; consumers spread their richer item type into this shape.
 */
export interface InlineArtworkItem {
  poster?: string | null;
  backdrop?: string | null;
  clearLogo?: string | null;
}

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

/**
 * Slot-aware variant of `useArtwork`. Skips the network call when every
 * `requiredSlots` entry is already present on the row payload (V44 inline
 * serve). When a required slot is missing the hook delegates to `useArtwork`,
 * preserving its query key + stale window so detail-page consumers keep
 * sharing the same cache entry as card consumers.
 */
export function useArtworkIfMissing(
  item: ArtworkRequestItem & InlineArtworkItem,
  requiredSlots: ReadonlyArray<ArtworkSlot>,
  opts: UseArtworkOptions = {},
): UseQueryResult<ArtworkBundle> {
  const haveAll = requiredSlots.every((slot) => Boolean(item[slot]));
  const query = useArtwork(item, { enabled: (opts.enabled ?? true) && !haveAll });
  // Destructure the URL fields so the dep array tracks exactly what
  // `synthFromItem` reads. Listing fields off `item` made the closure look
  // like it captured the full object, hiding the real reactive surface.
  const { poster, backdrop, clearLogo } = item;
  const synth = useMemo(
    () => synthFromItem({ poster, backdrop, clearLogo }),
    [poster, backdrop, clearLogo],
  );
  if (!haveAll) return query;
  return {
    ...query,
    data: synth,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    status: "success",
    error: null,
  } as UseQueryResult<ArtworkBundle>;
}

function synthFromItem(item: InlineArtworkItem): ArtworkBundle {
  return {
    poster: item.poster ? [{ url: item.poster, language: "en" }] : [],
    backdrop: item.backdrop ? [{ url: item.backdrop, language: "en" }] : [],
    clearLogo: item.clearLogo ? [{ url: item.clearLogo, language: "en" }] : [],
    thumb: [],
  };
}
