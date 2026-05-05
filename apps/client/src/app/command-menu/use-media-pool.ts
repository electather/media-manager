import { useMemo } from "react";

import { useHomeFeed } from "@/features/home/hooks/use-home-feed";
import type { HomeMediaItem } from "@/features/home/lib/types";

/**
 * Searchable pool for the command menu, derived from the home feed:
 * `pool` is every unique title (hero + every row), `trending` is the trending row.
 *
 * Today this is mock data sourced from `useHomeFeed`; once the real feed lands
 * (#TODO server integration) this hook is the single seam to swap in a remote
 * search API without rewriting the menu.
 */
export function useMediaPool(): { pool: HomeMediaItem[]; trending: HomeMediaItem[] } {
  const feed = useHomeFeed();

  return useMemo(() => {
    const seen = new Set<string>();
    const pool: HomeMediaItem[] = [];

    const add = (item: HomeMediaItem | null | undefined) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      pool.push(item);
    };

    add(feed.hero);
    feed.hero?.alternates.forEach(add);
    feed.rows.forEach((row) => row.items.forEach(add));

    const trending = feed.rows.find((row) => row.kind === "trendingNow")?.items ?? [];
    return { pool, trending };
  }, [feed]);
}
