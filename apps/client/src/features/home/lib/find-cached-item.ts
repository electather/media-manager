import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { CompactMediaItem, HomeLayoutResponse } from "@ent-mcp/shared/home";
import type { Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "@/shared/media/query-keys";
import { homeKeys } from "./query-keys";

/**
 * Walks the hero + media-source caches looking for an item with the given
 * composite `id`. Returns the cached `CompactMediaItem` or null if no row
 * has hydrated it yet. Used to seed `useHomeDetails` placeholder data so
 * the detail modal can render summary fields instantly while the rich
 * `media.getDetails` fetch is still in flight.
 *
 * Hero slides ride on the home layout cache; row items now ride on the shared
 * infinite source caches under `[...mediaKeys.root, "source"]` (design §B3).
 * That prefix also covers watchlist sections — harmless, since a hit returns
 * the same `CompactMediaItem` regardless of which list cached it.
 */
export function findCachedHomeItem(qc: QueryClient, id: string): CompactMediaItem | null {
  const layout = qc.getQueryData<HomeLayoutResponse>(homeKeys.layout());
  const heroHit = layout?.hero?.slides?.find((slide) => slide.item.id === id)?.item;
  if (heroHit) return heroHit;

  const sourceEntries = qc.getQueriesData<InfiniteData<Page>>({
    queryKey: [...mediaKeys.root, "source"],
  });
  for (const [, data] of sourceEntries) {
    if (!data) continue;
    for (const page of data.pages) {
      const hit = page.items.find((item) => item.id === id);
      if (hit) return hit;
    }
  }
  return null;
}
