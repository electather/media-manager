import { Hono } from "hono";
import { consola } from "consola";
import { z } from "zod";
import { mediaTypeSchema } from "@nama/shared/media";
import {
  addWatchlistRequestSchema,
  type AddWatchlistResponse,
  type WatchlistMoodSummary,
} from "@nama/shared/watchlist";
import { requireSession, sessionUserId } from "../../auth";
import { ArtworkService } from "../../artwork";
import { getCatalogService, toCanonicalRow } from "../../catalog";
import {
  addItem,
  decode,
  listRows,
  loadProgressMap,
  MediaService,
  removeItem,
  StatusBatchMemo,
  type AnyMediaSourceRegistration,
  type Cursor,
  type GetArtworkFn,
  type SourceContext,
} from "../../media";
import {
  buildContext as buildHomeContext,
  composeDetails,
  composeSeasonAvailability,
  homeMediaSources,
  makeRecommendationsMemo,
} from "../../home";
import { getMoodSummary, watchlistMediaSources } from "../../watchlist";
import { libraryMediaSources } from "../../library";
import { badRequest, notFound } from "../../diagnostics/http-errors";
import { zValidator } from "../../diagnostics/validator";
import { makeRateLimitMiddleware, rateLimitOrNull } from "../rate-limit";
import { TokenBucketLimiter } from "../../mcp/rate-limit";

/** ~30 add/remove ops per minute per user (burst=30, refill=0.5/s). Relocated from the
 *  deleted `watchlist` procedure at the §A8 cutover (the media surface owns the bucket now). */
export const watchlistWriteLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

/** Per-user read limiter for the watchlist route family. 30 burst; refill at 10/min to stop
 *  runaway poll loops while allowing the ~9-read landing-page fan-out. */
export const watchlistReadLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 10 / 60 });

/** The one media source registry (design §A4). Composed adapter-side so media never imports
 *  concrete sources (V.RG1); keyed by sourceId (unknown ids → 404). */
const REGISTRY: Record<string, AnyMediaSourceRegistration | undefined> = {
  ...homeMediaSources,
  ...watchlistMediaSources,
  ...libraryMediaSources,
};

/** Per-request plugin-call deadline budget, matching the home feed's `buildContext`. */
const REQUEST_DEADLINE_MS = 8000;

/** Path params for title resources (design §A6): `:type` lifted from `/home/details?mediaType=…`,
 *  `:tmdbId` numeric-only (parity with watchlistWriteParamSchema) so write-on-read cannot use opaque ids. */
const titleParamSchema = z
  .object({
    type: mediaTypeSchema,
    tmdbId: z.string().regex(/^\d+$/u, "tmdbId must be a numeric string"),
  })
  .strict();

/** Watchlist DELETE params (design §A6): `:type/:tmdbId` relocated from old route;
 *  numeric-only validation so non-numeric ids 400 not silently no-op (parity). */
const watchlistWriteParamSchema = z
  .object({
    type: mediaTypeSchema,
    tmdbId: z.string().regex(/^\d+$/u, "tmdbId must be a numeric string"),
  })
  .strict();

/** Permissive query validator: per-source shape is dynamic, parsed at request time
 *  against reg.paramSchema (authoritative). This schema exists only for RPC client typing —
 *  accepts string | string[] for multi-value params; no behavioral validation here. */
const sourceQuerySchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

/** Maps a registration's declared `rateLimit` to the limiter instance (design §A7). */
const limiterFor = { read: watchlistReadLimiter, write: watchlistWriteLimiter } as const;

// Route-scoped limits for fixed-bucket watchlist routes (§A7). Mounted per-route
// (not whole router) because title routes are unmetered and `/sources/:sourceId` picks its
// bucket dynamically. Read/write split mirrors `limiterFor`.
const readRateLimit = makeRateLimitMiddleware({ limiter: watchlistReadLimiter });
const writeRateLimit = makeRateLimitMiddleware({ limiter: watchlistWriteLimiter });

// Per-request deadline for watchlist moods/writes bridges. Hardcoded to 5000 (not
// REQUEST_DEADLINE_MS) for byte-identical relocation parity with old watchlist.ts §A6.
const WATCHLIST_REQUEST_DEADLINE_MS = 5000;

// SourceContext for resolver and listRows. Home rows use statusBatch (inline artwork);
// watchlist use getArtwork+toCanonicalRow (default pipeline). Mirrors asWatchlistContext
// wiring so watchlist sources enrich identically through resolver vs. old endpoints.
function buildSourceContext(userId: string): SourceContext {
  const mediaService = new MediaService(userId);
  const catalog = getCatalogService();
  return {
    userId,
    mediaService,
    catalog,
    statusBatch: new StatusBatchMemo(mediaService),
    recommendations: makeRecommendationsMemo(catalog, userId),
    logger: consola,
    deadlineMs: Date.now() + REQUEST_DEADLINE_MS,
    getArtwork: (requests) => new ArtworkService(userId, catalog).getArtwork(requests),
    toCanonicalRow,
  };
}

// Context for watchlist moods/writes bridges (§A6). Combines old watchlist.ts buildContext
// (5000 deadline, consola log) + asWatchlistContext resolution (loadProgressMap, getArtwork,
// toCanonicalRow) so getMoodSummary, addItem, removeItem stay byte-identical. Like buildHomeContext
// (dedicated ctor per target) not reused SourceContext, ensuring relocation parity.
function buildWatchlistContext(userId: string) {
  const catalog = getCatalogService();
  const getArtwork: GetArtworkFn = (requests) =>
    new ArtworkService(userId, catalog).getArtwork(requests);
  return {
    userId,
    mediaService: new MediaService(userId),
    catalog,
    loadProgressMap,
    deadlineMs: WATCHLIST_REQUEST_DEADLINE_MS,
    log: consola,
    getArtwork,
    toCanonicalRow,
  };
}

// Generic source resolver (design §A3). DUMB DISPATCH (V.MC1/V.PG1): look registration,
// apply rate limit, gate eligibility, parse paramSchema, decode OUTER cursor, build→listRows→Page.
// Source still decodes Cursor.k two-level. Mounted additively (§A8/D) beside old per-product endpoints.
export const mediaApp = new Hono()
  .use("*", requireSession)
  .get("/sources/:sourceId", zValidator("query", sourceQuerySchema), async (c) => {
    const sourceId = c.req.param("sourceId");
    // `Object.hasOwn` guard: a bare `REGISTRY[sourceId]` returns the prototype
    // chain value for names like `__proto__` / `constructor` (truthy), which
    // would slip past the `!reg` 404 and crash on `reg.paramSchema` (500).
    const reg = Object.hasOwn(REGISTRY, sourceId) ? REGISTRY[sourceId] : undefined;
    if (!reg) {
      throw notFound("media.source_unknown", `unknown media source: ${sourceId}`);
    }

    const userId = sessionUserId(c);
    if (reg.rateLimit) {
      const limited = rateLimitOrNull(limiterFor[reg.rateLimit], c, userId);
      if (limited) return limited;
    }

    const ctx = buildSourceContext(userId);

    // Eligibility is a home-row concern (defense-in-depth for direct hits;
    // mirrors today's `composeRowPage` 404-on-ineligible, including its
    // catch → treat-as-ineligible). Watchlist registrations carry none.
    if (reg.eligibility) {
      const eligible = await reg.eligibility(ctx).catch(() => false);
      if (!eligible) {
        throw notFound("media.source_ineligible", `media source ineligible: ${sourceId}`);
      }
    }

    // c.req.valid("query") flattens multi-value params: single→string, repeated→string[].
    // Per-source schema is authoritative; single-value (home/watchlist) see strings,
    // library lens accepts arrays for uniform multi-value filter support.
    const parsed = reg.paramSchema.safeParse(c.req.valid("query"));
    if (!parsed.success) {
      throw badRequest("http.invalid_input", parsed.error.message, { target: "query" });
    }

    const cursor = resolveCursor(c.req.query("cursor"), reg, sourceId);

    const { source, cfg, enrichRows } = reg.build(ctx, parsed.data, cursor);
    const page = enrichRows
      ? await listRows(source, cfg, ctx, enrichRows)
      : await listRows(source, cfg, ctx);
    return c.json(page);
  })
  // Title resource (design §A2/§A6): media details + per-server availability.
  // Pure URL relocation of /home/details?mediaType=… (V.A1, RISK-203 — no composition logic
  // leaves home). Details carries seasons in MediaDetailsExtra, so no separate /seasons endpoint.
  .get("/:type/:tmdbId/details", zValidator("param", titleParamSchema), async (c) => {
    const userId = sessionUserId(c);
    const { type, tmdbId } = c.req.valid("param");
    const ctx = buildHomeContext(userId);
    const details = await composeDetails(ctx, tmdbId, type);
    return c.json(details);
  })
  .get("/:type/:tmdbId/availability", zValidator("param", titleParamSchema), async (c) => {
    const userId = sessionUserId(c);
    const { tmdbId } = c.req.valid("param");
    const ctx = buildHomeContext(userId);
    const availability = await composeSeasonAvailability(ctx, tmdbId);
    return c.json(availability);
  })
  // Watchlist mood summary (design §A6): URL relocation of /watchlist/moods.
  // One-line bridge; derivation/tally ownership unchanged (§G consolidation).
  // watchlistReadLimiter preserved per §A7 (same bucket, keys unchanged).
  .get("/moods", readRateLimit, async (c) => {
    const userId = sessionUserId(c);
    const summary: WatchlistMoodSummary = await getMoodSummary(buildWatchlistContext(userId));
    return c.json(summary);
  })
  // Watchlist writes (design §A6): add/remove via media-owned barrel (addItem/removeItem,
  // Phase 2). POST returns AddWatchlistResponse (201 new, 200 active); DELETE is 204.
  // writeRateLimit mounted AFTER validator (invalid schema 400s without debiting bucket) §A7 parity.
  .post("/watchlist", zValidator("json", addWatchlistRequestSchema), writeRateLimit, async (c) => {
    const userId = sessionUserId(c);
    const { tmdbId, mediaType, source } = c.req.valid("json");
    const result = await addItem({ tmdbId, mediaType }, source, buildWatchlistContext(userId));
    const body: AddWatchlistResponse = { item: result.item, wasActive: result.wasActive };
    return c.json(body, result.wasActive ? 200 : 201);
  })
  .delete(
    "/watchlist/:type/:tmdbId",
    zValidator("param", watchlistWriteParamSchema),
    writeRateLimit,
    async (c) => {
      const userId = sessionUserId(c);
      const { type, tmdbId } = c.req.valid("param");
      await removeItem({ tmdbId, mediaType: type }, buildWatchlistContext(userId));
      return c.body(null, 204);
    },
  );

// Decode opaque outer cursor per consumer V.CU1 under one resolver (design §A3).
// Home rows: static cursorMode, decode STRICTLY (bad cursor→400, requiresInitialCursor→400).
// watchlist-items: dynamic mode flips on sort/bucket/mood, decode LENIENTLY (cursorOnNull: "firstPage"),
// matching old readSection (cursorMode from built source.stages, never 400).
function resolveCursor(
  raw: string | undefined,
  reg: AnyMediaSourceRegistration,
  sourceId: string,
): Cursor | null {
  // A missing cursor — or the literal `"null"` the old home query encoded for
  // "no cursor" — is the first page.
  const hasCursor = raw !== undefined && raw !== "" && raw !== "null";
  let cursor: Cursor | null = null;
  if (hasCursor) {
    cursor = reg.cursorOnNull === "400" ? decode(raw, reg.cursorMode) : decode(raw);
    if (cursor === null && reg.cursorOnNull === "400") {
      throw badRequest("media.cursor_invalid", `invalid cursor for ${sourceId}`);
    }
  }
  if (cursor === null && reg.requiresInitialCursor) {
    throw badRequest("media.cursor_required", `${sourceId} requires an initial cursor`);
  }
  return cursor;
}
