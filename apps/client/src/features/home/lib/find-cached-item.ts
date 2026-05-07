import type { QueryClient } from "@tanstack/react-query";
import type {
  CompactMediaItem,
  HomeLayoutResponse,
  RowContentResponse,
} from "@ent-mcp/shared/home";
import { homeKeys } from "./query-keys";

/**
 * Walks the home row + hero caches looking for an item with the given
 * composite `id`. Returns the cached `CompactMediaItem` or null if no row
 * has hydrated it yet. Used to seed `useHomeDetails` placeholder data so
 * the detail modal can render summary fields instantly while the rich
 * `home.getDetails` fetch is still in flight.
 *
 * Hero slides ride on the layout cache; row items ride on per-row infinite
 * caches keyed under `homeKeys.rowsAll()`.
 */
export function findCachedHomeItem(qc: QueryClient, id: string): CompactMediaItem | null {
  const layout = qc.getQueryData<HomeLayoutResponse>(homeKeys.layout());
  const heroHit = layout?.hero?.slides?.find((slide) => slide.item.id === id)?.item;
  if (heroHit) return heroHit;

  const rowEntries = qc.getQueriesData<{ pages: RowContentResponse[] }>({
    queryKey: homeKeys.rowsAll(),
  });
  for (const [, data] of rowEntries) {
    if (!data) continue;
    for (const page of data.pages) {
      const hit = page.items.find((item) => item.id === id);
      if (hit) return hit;
    }
  }
  return null;
}
