import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { CompactMediaItem, HomeLayoutResponse } from "@nama/shared/home";
import type { Page } from "@nama/shared/media";
import { mediaKeys } from "@/shared/media/query-keys";
import { homeKeys } from "./query-keys";

// Seeds useHomeDetails placeholder (hero cache + media source caches under mediaKeys.root/"source"). Relies on invariant V.WIRE1 — all sources must page identical Page/CompactMediaItem shape.
export function findCachedMediaItem(qc: QueryClient, id: string): CompactMediaItem | null {
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
