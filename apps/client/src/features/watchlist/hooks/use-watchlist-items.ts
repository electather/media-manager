import type { WatchlistBucket } from "@ent-mcp/shared/watchlist";
import { useAllItems } from "./use-all-items";

export interface UseWatchlistItemsArgs {
  filter?: WatchlistBucket;
}

/**
 * Deprecated alias — `useAllItems({ bucket })` is the per-section replacement.
 * Phase 4 of the watchlist-sections plan removes this file once the legacy
 * curated `watchlist-content.tsx` consumer migrates to per-section hooks.
 */
export function useWatchlistItems(args: UseWatchlistItemsArgs = {}) {
  const opts: { bucket?: WatchlistBucket } = {};
  if (args.filter) opts.bucket = args.filter;
  return useAllItems(opts);
}
