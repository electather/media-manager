/**
 * Raw aggregate reads over per-user plugin data backing the MediaService
 * facade. Each wrapper fans out via `dispatchAggregate` and returns the merged
 * array, swallowing the partial-failure metadata that the home-feed variants
 * in `home-feeds.ts` surface.
 */
import { dispatchAggregate } from "./dispatch";

/**
 * Aggregate `watchHistory@v1.getHistory` for the catalog mirror sync.
 * The optional `pluginId` narrows the dispatch to a single plugin so the
 * per-connection cursor advancement stays accurate when a user has
 * multiple history-emitting plugins. The dispatcher itself has no
 * `connectionId` filter; callers that need finer-grained narrowing run
 * one mirror-sync row per `(userId, pluginId)` and tag events with the
 * connection identity at the application layer.
 */
export async function getAllHistory(userId: string, pluginId?: string): Promise<unknown[]> {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "watchHistory",
    version: "v1",
    method: "getHistory",
    input: {},
    ...(pluginId ? { pluginId } : {}),
  });
  return result.data ?? [];
}

/** Aggregate `ratings@v1.getRatings` — same shape as `getAllHistory`. */
export async function getAllRatings(userId: string, pluginId?: string): Promise<unknown[]> {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "ratings",
    version: "v1",
    method: "getRatings",
    input: {},
    ...(pluginId ? { pluginId } : {}),
  });
  return result.data ?? [];
}

export async function getHistory(userId: string, limit?: number) {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "watchHistory",
    version: "v1",
    method: "getHistory",
    input: { limit },
  });
  return result.data ?? [];
}

export async function getWatchlist(userId: string, type?: "movie" | "tv") {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "watchlist",
    version: "v1",
    method: "getWatchlist",
    input: { type },
  });
  return result.data ?? [];
}

export async function getUpcoming(userId: string) {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "calendar",
    version: "v1",
    method: "getUpcoming",
    input: {},
  });
  return result.data ?? [];
}

export async function getRecommendations(userId: string, type?: "movie" | "tv", limit?: number) {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "recommendations",
    version: "v1",
    method: "getRecommendations",
    input: { type, limit },
  });
  return result.data ?? [];
}
