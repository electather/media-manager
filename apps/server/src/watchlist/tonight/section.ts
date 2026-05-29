import type { WatchlistSectionResponse } from "@ent-mcp/shared/watchlist";
import { listRows } from "../../media";
import { MemoryCache } from "../../cache/memory";
import { toSourceContext, type WatchlistSourceCtx } from "../sources/context";
import { tonightCfg, tonightSource } from "../sources/tonight";
import { pick } from "./pick";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 5000;
const cache = new MemoryCache(CACHE_MAX_ENTRIES);

function sectionCacheKey(userId: string): string {
  return `watchlist:tonight:${userId}`;
}

/**
 * Tonight section: hero + ≤4 alternates from the user's ready / in-progress
 * pool. The `tonight` `MediaSource` runs the cheap classify pre-filter and the
 * media pipeline (`listRows`) enriches the candidates into a flat page; the
 * watchlist-product ranking + hero/alternate split (`pick`) runs here, in the
 * envelope, because `score` reads enriched fields the source's raw rows don't
 * carry (V.TN1 — `Page.items` stays flat, the split is envelope-side). Cached
 * 5 min per user (RISK-007 / V.WL4); invalidated on watchlist mutation.
 */
export async function getSection(c: WatchlistSourceCtx): Promise<WatchlistSectionResponse> {
  // fallow-ignore-next-line code-duplication
  const key = sectionCacheKey(c.userId);
  const hit = await cache.get<WatchlistSectionResponse>(key);
  if (hit !== null) return hit;

  const page = await listRows(tonightSource, tonightCfg(), toSourceContext(c));
  // `pick` reduces the flat ranked page (`CompactMediaItem[]`) to items[0] hero
  // + ≤4 alternates.
  const result = pick(page.items);
  // fallow-ignore-next-line code-duplication
  const section: WatchlistSectionResponse = {
    items: result.items,
    partial: page.partial || result.partial,
  };
  await cache.set(key, section, CACHE_TTL_MS);
  return section;
}

export async function invalidateTonightSection(userId: string): Promise<void> {
  await cache.delete(sectionCacheKey(userId));
}

/** Test-only. */
export async function __resetTonightCache(): Promise<void> {
  await cache.clear("watchlist:tonight:");
}
