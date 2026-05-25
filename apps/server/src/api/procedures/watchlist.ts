import { Hono } from "hono";
import { consola } from "consola";
import {
  addWatchlistRequestSchema,
  itemsQuerySchema,
  moodItemsQuerySchema,
  moodParamSchema,
  recentlyQuerySchema,
  watchlistParamSchema,
  type AddWatchlistResponse,
  type WatchlistCounts,
  type WatchlistMoodSummary,
  type WatchlistResponse,
  type WatchlistSectionResponse,
} from "@ent-mcp/shared/watchlist";
import { requireSession, sessionUserId } from "../../auth";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { TokenBucketLimiter } from "../../mcp/rate-limit";
import { zValidator } from "../../diagnostics/validator";
import {
  addItem,
  getCounts,
  getMoodSummary,
  getRecentlyAdded,
  getTonightSection,
  listItems,
  listMoodItems,
  removeItem,
  type WatchlistContext,
} from "../../watchlist";

/** ~30 add/remove ops per minute per user (burst=30, refill=0.5/s). */
export const watchlistWriteLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

/**
 * Per-user read limiter for the watchlist route family. First call seeds
 * via the plugin watchlist feed; without a throttle a misbehaving client
 * could trigger repeated plugin storms on every poll interval. The curated
 * landing page itself fires ~9 reads in one paint (counts + tonight +
 * recently + moods summary + N mood preview clusters + sections), so the
 * burst must comfortably exceed a single page-load fan-out. Refill stays
 * generous enough for poll-driven background work but slow enough to choke
 * a tight retry loop. ~30 burst / 1 token per 6 s sustained, plus the
 * client's 60 s `staleTime` on read hooks.
 */
export const watchlistReadLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 10 / 60 });

const REQUEST_DEADLINE_MS = 5000;

function buildContext(userId: string): WatchlistContext {
  return {
    userId,
    mediaService: new MediaService(userId),
    catalog: getCatalogService(),
    deadlineMs: REQUEST_DEADLINE_MS,
    log: consola,
  };
}

function rateLimitOrNull(c: Parameters<typeof sessionUserId>[0], userId: string) {
  const limited = watchlistReadLimiter.check(userId, 1);
  if (limited === null) return null;
  const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
  return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
}

export const watchlistApp = new Hono()
  .use("*", requireSession)
  .get("/items", zValidator("query", itemsQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(c, userId);
    if (limited) return limited;
    const { cursor, limit, sort, bucket, mood } = c.req.valid("query");
    const ctx = buildContext(userId);
    const opts: Parameters<typeof listItems>[1] = { limit, sort };
    if (cursor) opts.cursor = cursor;
    if (bucket) opts.bucket = bucket;
    if (mood) opts.mood = mood;
    const response: WatchlistResponse = await listItems(ctx, opts);
    return c.json(response);
  })
  .get("/sections/tonight", async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(c, userId);
    if (limited) return limited;
    const ctx = buildContext(userId);
    const response: WatchlistSectionResponse = await getTonightSection(ctx);
    return c.json(response);
  })
  .get("/sections/recently", zValidator("query", recentlyQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(c, userId);
    if (limited) return limited;
    const { limit } = c.req.valid("query");
    const ctx = buildContext(userId);
    const response: WatchlistSectionResponse = await getRecentlyAdded(ctx, limit);
    return c.json(response);
  })
  .get("/moods", async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(c, userId);
    if (limited) return limited;
    const ctx = buildContext(userId);
    const response: WatchlistMoodSummary = await getMoodSummary(ctx);
    return c.json(response);
  })
  .get(
    "/moods/:moodId/items",
    zValidator("param", moodParamSchema),
    zValidator("query", moodItemsQuerySchema),
    async (c) => {
      const userId = sessionUserId(c);
      const limited = rateLimitOrNull(c, userId);
      if (limited) return limited;
      const { moodId } = c.req.valid("param");
      const { cursor, limit } = c.req.valid("query");
      const ctx = buildContext(userId);
      const opts: Parameters<typeof listMoodItems>[2] = { limit };
      if (cursor) opts.cursor = cursor;
      const response: WatchlistResponse = await listMoodItems(ctx, moodId, opts);
      return c.json(response);
    },
  )
  .get("/counts", async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(c, userId);
    if (limited) return limited;
    const ctx = buildContext(userId);
    const counts: WatchlistCounts = await getCounts(ctx);
    return c.json(counts);
  })
  .post("/", zValidator("json", addWatchlistRequestSchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = watchlistWriteLimiter.check(userId, 1);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
    const { tmdbId, mediaType, source } = c.req.valid("json");
    const ctx = buildContext(userId);
    const result = await addItem({ tmdbId, mediaType }, source, ctx);
    const body: AddWatchlistResponse = { item: result.item, wasActive: result.wasActive };
    return c.json(body, result.wasActive ? 200 : 201);
  })
  .delete("/:tmdbId/:mediaType", zValidator("param", watchlistParamSchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = watchlistWriteLimiter.check(userId, 1);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
    const { tmdbId, mediaType } = c.req.valid("param");
    const ctx = buildContext(userId);
    await removeItem({ tmdbId, mediaType }, ctx);
    return c.body(null, 204);
  });
