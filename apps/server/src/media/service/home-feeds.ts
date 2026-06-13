/**
 * Home-feed getters backing the MediaService facade. Every function returns
 * (or feeds) the `HomeAggregate` envelope so the home orchestrator sees
 * uniform `partial` / `AllPluginsFailedError` semantics across rows.
 */
import type { ContinueWatchingEntry } from "@nama/plugin-sdk";
import { dispatchAggregate, dispatchPrimary } from "./dispatch";
import { interpretAggregate, type HomeAggregate } from "./interpret-aggregate";
import type { DiscoverFilters } from "./metadata";

/**
 * Filter set accepted by the `newReleases` discover feed. Extends the base
 * `DiscoverFilters` so shared fields stay in sync and any future addition to
 * the metadata discover filters propagates here automatically.
 */
export interface DiscoverFeedFilters extends DiscoverFilters {
  releaseDateGte?: number;
  releaseDateLte?: number;
  sort?: "popularity_desc" | "popularity_asc" | "release_date_desc" | "release_date_asc";
  deadlineMs?: number;
}

/** Seed input for the `becauseYouWatched` similar feed. */
export interface SimilarFeedInput {
  id: string;
  type: "movie" | "tv";
  deadlineMs?: number;
}

/** Options shared by the ranked `recommendations@v1` feeds. */
export interface RankedFeedOptions {
  mediaType?: "movie" | "tv";
  limit?: number;
  deadlineMs?: number;
}

/**
 * Aggregate `watchHistory@v1.getInProgress`. Plugins that do not implement
 * the method are skipped at the dispatcher layer; if any of the surviving
 * providers return data the row renders, with `partial: true` set when at
 * least one peer errored. Throws `AllPluginsFailedError` only when every
 * resolved provider errored, so the row can be flagged `all_failed`.
 */
export async function getInProgress(
  userId: string,
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<HomeAggregate<unknown[]>> {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "watchHistory",
    version: "v1",
    method: "getInProgress",
    input: { limit: opts.limit },
    deadlineMs: opts.deadlineMs,
  });
  return interpretAggregate("watchHistory@v1", result);
}

/**
 * Cheap count signal for the layout snapshot. Reads through the
 * `watchlist@v1` aggregate cache; on full failure returns zero so the home
 * feed can drop the row without surfacing the underlying plugin error.
 */
export async function getWatchlistCount(userId: string): Promise<number> {
  try {
    const result = await dispatchAggregate<unknown[]>({
      userId,
      capability: "watchlist",
      version: "v1",
      method: "getWatchlist",
      input: {},
    });
    return Array.isArray(result.data) ? result.data.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Count of in-progress shows that have at least one upcoming episode. The
 * home feed uses this as a layout-time gate for `upcomingForYou`; if the
 * underlying calendar cache is cold the layout falls back to dropping the
 * row this snapshot, so failures here resolve to zero.
 */
// fallow-ignore-next-line complexity
export async function getCalendarProgressCount(userId: string): Promise<number> {
  try {
    const [inProgress, upcoming] = await Promise.all([
      getInProgress(userId),
      dispatchAggregate<unknown[]>({
        userId,
        capability: "calendar",
        version: "v1",
        method: "getUpcoming",
        input: {},
      }),
    ]);
    const upcomingShows = new Set<string>();
    for (const entry of upcoming.data ?? []) {
      const tmdbId = readTmdbId(entry);
      if (tmdbId) upcomingShows.add(tmdbId);
    }
    let count = 0;
    for (const item of inProgress.items) {
      const tmdbId = readNestedTmdbId(item);
      if (tmdbId && upcomingShows.has(tmdbId)) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Primary `metadata@v1.discover` — used by the `newReleases` row. */
export async function discoverFeed(
  userId: string,
  filters: DiscoverFeedFilters,
): Promise<HomeAggregate<unknown[]>> {
  const { deadlineMs, ...input } = filters;
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "discover",
    input,
    deadlineMs,
  });
  return interpretAggregate("metadata@v1", result);
}

/**
 * Primary `metadata@v1.getSimilar` — used by `becauseYouWatched` keyed on
 * the cursor-pinned seed media id.
 */
export async function getSimilarFeed(
  userId: string,
  input: SimilarFeedInput,
): Promise<HomeAggregate<unknown[]>> {
  const { deadlineMs, ...rest } = input;
  const result = await dispatchPrimary<unknown[]>({
    userId,
    capability: "metadata",
    version: "v1",
    method: "getSimilar",
    input: rest,
    mediaType: rest.type,
    deadlineMs,
  });
  return interpretAggregate("metadata@v1", result);
}

/**
 * Shared fan-out for the home-feed aggregate getters. Dispatches `method` on
 * `capability@v1` with an empty input, then interprets the result so the
 * `partial` flag and `AllPluginsFailedError` semantics are identical across
 * every feed. The `capability@v1` interpret key is derived from `capability`
 * so the two never drift.
 */
async function aggregateFeed<T>(
  userId: string,
  capability: string,
  method: string,
  deadlineMs?: number,
): Promise<HomeAggregate<T[]>> {
  const result = await dispatchAggregate<T[]>({
    userId,
    capability,
    version: "v1",
    method,
    input: {},
    deadlineMs,
  });
  return interpretAggregate(`${capability}@v1`, result);
}

/**
 * Aggregate `calendar@v1.getUpcoming`. Distinct from the legacy
 * `getUpcoming` getter on the facade: this variant surfaces a `partial`
 * flag and an `AllPluginsFailedError` so the home feed orchestrator can
 * classify the row outcome correctly.
 */
export async function getUpcomingFeed(
  userId: string,
  opts: { deadlineMs?: number } = {},
): Promise<HomeAggregate<unknown[]>> {
  return aggregateFeed<unknown>(userId, "calendar", "getUpcoming", opts.deadlineMs);
}

/**
 * Aggregate `watchlist@v1.getWatchlist` for the home-feed `yourWatchlist`
 * row. Surfaces partial-failure signalling that the legacy `getWatchlist`
 * getter swallows.
 */
export async function getWatchlistFeed(
  userId: string,
  opts: { deadlineMs?: number } = {},
): Promise<HomeAggregate<unknown[]>> {
  return aggregateFeed<unknown>(userId, "watchlist", "getWatchlist", opts.deadlineMs);
}

/**
 * Aggregate `collection@v1.getCollection` for the owned-library membership
 * sync. Mirrors `getWatchlistFeed`: surfaces the `partial` flag and throws
 * `AllPluginsFailedError` on a terminal all-providers failure so the library
 * sync can classify the run outcome. The library module is the first consumer
 * of this capability (design §Sync + hydrate).
 */
export async function getCollectionFeed(
  userId: string,
  opts: { deadlineMs?: number } = {},
): Promise<HomeAggregate<unknown[]>> {
  return aggregateFeed<unknown>(userId, "collection", "getCollection", opts.deadlineMs);
}

/** Aggregate `recommendations@v1.getTrending`. */
export async function getTrendingFeed(
  userId: string,
  opts: RankedFeedOptions,
): Promise<HomeAggregate<unknown[]>> {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "recommendations",
    version: "v1",
    method: "getTrending",
    input: { type: opts.mediaType, limit: opts.limit },
    deadlineMs: opts.deadlineMs,
  });
  return interpretAggregate("recommendations@v1", result);
}

/** Aggregate `recommendations@v1.getRecommendations` — raw candidates feed. */
export async function getRecommendationsFeed(
  userId: string,
  opts: RankedFeedOptions,
): Promise<HomeAggregate<unknown[]>> {
  const result = await dispatchAggregate<unknown[]>({
    userId,
    capability: "recommendations",
    version: "v1",
    method: "getRecommendations",
    input: { type: opts.mediaType, limit: opts.limit },
    deadlineMs: opts.deadlineMs,
  });
  return interpretAggregate("recommendations@v1", result);
}

/**
 * Aggregate `continueWatching@v1.getContinueWatching`. Mirrors the
 * `getWatchlistFeed` pattern — surfaces a `partial` flag plus throws
 * `AllPluginsFailedError` when every attempted provider errors so the home
 * orchestrator can flag the row outcome. Used by the
 * `continueWatching-active`, `continueWatching-next`, and hero cascade.
 */
export async function getContinueWatchingFeed(
  userId: string,
  opts: { deadlineMs?: number } = {},
): Promise<HomeAggregate<ContinueWatchingEntry[]>> {
  return aggregateFeed<ContinueWatchingEntry>(
    userId,
    "continueWatching",
    "getContinueWatching",
    opts.deadlineMs,
  );
}

/**
 * Best-effort lookup of a `tmdbId` field on aggregate calendar entries. The
 * shape is deliberately untyped at the dispatcher boundary — different
 * calendar plugins surface it under `item.ids.tmdb_id`, `tmdbId`, or `id`.
 */
// fallow-ignore-next-line complexity
function readTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const flat = typeof v.tmdbId === "string" ? v.tmdbId : null;
  if (flat) return flat;
  const item = v.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const ids = item.ids as Record<string, unknown> | undefined;
  const tmdb = ids?.tmdb_id;
  if (typeof tmdb === "string") return tmdb;
  const id = item.id;
  if (typeof id === "string" && id.includes(":")) return id.split(":")[1] ?? null;
  return null;
}

function readNestedTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = (value as { item?: unknown }).item;
  return readTmdbId({ item });
}
