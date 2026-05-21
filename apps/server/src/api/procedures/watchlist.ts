import { Hono } from "hono";
import { consola } from "consola";
import {
  addWatchlistRequestSchema,
  watchlistListQuerySchema,
  watchlistParamSchema,
  type AddWatchlistResponse,
  type WatchlistCounts,
  type WatchlistResponse,
} from "@ent-mcp/shared/watchlist";
import { requireSession, sessionUserId } from "../../auth";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { TokenBucketLimiter } from "../../mcp/rate-limit";
import { zValidator } from "../../diagnostics/validator";
import { addItem, getCounts, getItems, removeItem, type WatchlistContext } from "../../watchlist";

/** ~30 add/remove ops per minute per user (burst=30, refill=0.5/s). */
export const watchlistWriteLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

/**
 * Per-user read limiter for `GET /watchlist`. First call seeds via the
 * plugin watchlist feed; without a throttle a misbehaving client could
 * trigger repeated plugin storms on every poll interval. ~10 reads / 60 s
 * (burst=10, refill=10/min) plus the client's 60 s `staleTime` keeps the
 * happy-path load model intact.
 */
export const watchlistReadLimiter = new TokenBucketLimiter({ capacity: 10, refillPerSec: 10 / 60 });

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

export const watchlistApp = new Hono()
  .use("*", requireSession)
  .get("/", zValidator("query", watchlistListQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = watchlistReadLimiter.check(userId, 1);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
    const { cursor, limit, filter } = c.req.valid("query");
    const ctx = buildContext(userId);
    const opts: Parameters<typeof getItems>[1] = { limit };
    if (cursor) opts.cursor = cursor;
    if (filter) opts.filter = filter;
    const response: WatchlistResponse = await getItems(ctx, opts);
    return c.json(response);
  })
  .get("/counts", async (c) => {
    const userId = sessionUserId(c);
    const limited = watchlistReadLimiter.check(userId, 1);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
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
