import { and, eq } from "drizzle-orm";
import type { WatchlistKey } from "@nama/shared/watchlist";
import type { Db } from "../../db/client";
import { watchlistItems } from "../../db/schema/media";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Single-row lookup for `(userId, key)` on `watchlist_items`. Shared by read
 * + transactional writes so the predicate is defined once; `exec` is `Db` or `tx`.
 */
export function selectRowByKey(
  exec: Db | Tx,
  userId: string,
  key: WatchlistKey,
): Promise<typeof watchlistItems.$inferSelect | undefined> {
  return exec
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.tmdbId, key.tmdbId),
        eq(watchlistItems.mediaType, key.mediaType),
      ),
    )
    .get();
}
