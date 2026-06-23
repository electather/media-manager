/**
 * Aggregate reads over plugin data (via `dispatchAggregate`). Unlike home-feed variants in
 * `home-feeds.ts`, these swallow partial-failure metadata and return merged arrays.
 */
import { dispatchAggregate } from "./dispatch";

/**
 * Aggregate `watchHistory@v1.getHistory` for catalog mirror sync.
 * Optional `pluginId` narrows dispatch for per-connection cursor accuracy (dispatcher has no `connectionId` filter).
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

/** Aggregate `watchHistory@v1.getHistory` for feed display. Optional `limit` caps result count; unlike `getAllHistory` there is no per-plugin filter. */
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
