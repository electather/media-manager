import { Hono } from "hono";
import { consola } from "consola";
import { z } from "zod";
import { mediaTypeSchema } from "@ent-mcp/shared/media";
import {
  addWatchlistRequestSchema,
  type AddWatchlistResponse,
  type WatchlistMoodSummary,
} from "@ent-mcp/shared/watchlist";
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
} from "../../home";
import { getMoodSummary, watchlistMediaSources } from "../../watchlist";
import { libraryMediaSources } from "../../library";
import { badRequest, notFound } from "../../diagnostics/http-errors";
import { zValidator } from "../../diagnostics/validator";
import { rateLimitOrNull } from "../rate-limit";
import { TokenBucketLimiter } from "../../mcp/rate-limit";

/** ~30 add/remove ops per minute per user (burst=30, refill=0.5/s). Relocated from the
 *  deleted `watchlist` procedure at the §A8 cutover (the media surface owns the bucket now). */
export const watchlistWriteLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

/** Per-user read limiter for the watchlist route family. 30 burst; refill at 10/min to stop
 *  runaway poll loops while allowing the ~9-read landing-page fan-out. */
export const watchlistReadLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 10 / 60 });

/**
 * The one media source registry (design §A4). It is composed adapter-side from
 * the two consumer barrels, so `media` never imports a concrete source
 * (invariant V.RG1) and no composition logic moves between modules (invariant
 * V.A1 — each consumer only re-packages its own wiring). Keyed by `sourceId`;
 * unknown ids resolve to `undefined` → 404.
 */
const REGISTRY: Record<string, AnyMediaSourceRegistration | undefined> = {
  ...homeMediaSources,
  ...watchlistMediaSources,
  ...libraryMediaSources,
};

/** Per-request plugin-call deadline budget, matching the home feed's `buildContext`. */
const REQUEST_DEADLINE_MS = 8000;

/**
 * Path params for the title resource endpoints (design §A6). `:type` is the
 * media type (`movie`/`tv`) lifted out of today's `/home/details?mediaType=…`
 * query; `:tmdbId` is the catalog id. Invalid values fail the same
 * `http.invalid_input` 400 the old query validation raised.
 */
const titleParamSchema = z
  .object({
    type: mediaTypeSchema,
    tmdbId: z.string().min(1),
  })
  .strict();

/**
 * Path params for the watchlist `DELETE` write (design §A6). `:type/:tmdbId` lift
 * the old `DELETE /watchlist/:tmdbId/:mediaType` route's params; `tmdbId` keeps
 * the old numeric-string validation so a non-numeric id still 400s rather than
 * silently no-opping (parity with `watchlistParamSchema`).
 */
const watchlistWriteParamSchema = z
  .object({
    type: mediaTypeSchema,
    tmdbId: z.string().regex(/^\d+$/u, "tmdbId must be a numeric string"),
  })
  .strict();

/**
 * Permissive query validator for the generic resolver. The per-source param
 * shape is dynamic — it is picked off the registration at request time and
 * parsed against `reg.paramSchema` inside the handler — so the route cannot
 * statically validate the query. This static schema exists only so the typed
 * Hono RPC client can send `?<source params>&cursor` through
 * `api.media.sources[":sourceId"].$get({ query })`; query values are always
 * strings, so it accepts any string map and adds no behavioral validation
 * (the handler's `reg.paramSchema.safeParse(c.req.query())` is authoritative).
 */
const sourceQuerySchema = z.record(z.string(), z.string());

/** Maps a registration's declared `rateLimit` to the limiter instance (design §A7). */
const limiterFor = { read: watchlistReadLimiter, write: watchlistWriteLimiter } as const;

/**
 * Per-request plugin-call deadline for the watchlist moods / writes
 * bridges. Matches the old `watchlist.ts` procedure's `buildContext` constant
 * exactly (5000) so those endpoints stay byte-identical through the relocation
 * (parity, §A6). It is deliberately NOT the resolver's `REQUEST_DEADLINE_MS`.
 */
const WATCHLIST_REQUEST_DEADLINE_MS = 5000;

/**
 * Build the single media `SourceContext` the resolver hands every source plus
 * `listRows`. It unions the handles both consumers need: home rows read
 * `statusBatch` (their enrich override builds its own artwork inline), while
 * watchlist sources run the default pipeline enrich and read `getArtwork` +
 * `toCanonicalRow`. A field a given source ignores is harmless. `getArtwork`
 * mirrors the watchlist `asWatchlistContext` wiring so the watchlist sources
 * enrich identically through the resolver as through their old endpoints.
 */
function buildSourceContext(userId: string): SourceContext {
  const mediaService = new MediaService(userId);
  const catalog = getCatalogService();
  return {
    userId,
    mediaService,
    catalog,
    statusBatch: new StatusBatchMemo(mediaService),
    logger: consola,
    deadlineMs: Date.now() + REQUEST_DEADLINE_MS,
    getArtwork: (requests) => new ArtworkService(userId, catalog).getArtwork(requests),
    toCanonicalRow,
  };
}

/**
 * Per-request context for the watchlist moods / writes bridges
 * (design §A6). It reproduces the old `watchlist.ts` procedure's `buildContext`
 * (`deadlineMs: 5000`, `log: consola`) PLUS the `asWatchlistContext` resolution
 * (`loadProgressMap` + the `getArtwork` / `toCanonicalRow` cycle-breakers), so a
 * single object serves both the read aggregate — `getMoodSummary` takes the
 * loose `MaybeRowContext` — and the media writes barrel — `addItem` /
 * `removeItem` take the resolved `MediaEnrichContext`. The aggregates re-resolve
 * their own enrich handles, so the extra fields are inert for them: the bridge
 * stays behaviorally identical to the old endpoints.
 *
 * This is the watchlist analogue of `buildHomeContext` for the title routes —
 * a dedicated ctor per bridge target keeps each relocated endpoint byte-identical
 * to the one it replaces, rather than reusing the resolver's `SourceContext`.
 */
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

/**
 * The generic source resolver (design §A3): one handler dispatched by `sourceId`
 * across every paginated read. It is DUMB DISPATCH (invariants V.MC1/V.PG1 — no
 * enrich/sort/cursor logic here): look the registration up, apply its rate limit,
 * gate eligibility, parse its param schema, decode only the opaque OUTER cursor,
 * then `build` → `listRows` → return the one `Page` shape. The source still
 * parses its seed/keyset payload out of `Cursor.k` (two-level decode, unchanged).
 *
 * `requireSession` is applied on the router; `sessionUserId(c)` is read per
 * handler. Mounted additively (design §A8 / D) — the old per-product endpoints
 * stay live until the cutover.
 */
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

    const parsed = reg.paramSchema.safeParse(c.req.query());
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
  /**
   * Title resource (design §A2/§A6): a media title's details and per-server
   * availability under the media URL namespace. Pure URL relocation — `:type`
   * was the `/home/details?mediaType=…` query; the bridge is one line to the
   * existing home composer, so no composition logic moves out of `home`
   * (invariant V.A1, RISK-203). `details` already carries seasons metadata
   * inside `MediaDetailsExtra`, so there is no separate `/seasons` endpoint.
   */
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
  /**
   * Watchlist mood summary (design §A6): a URL relocation of `/watchlist/moods`
   * — one line to the existing watchlist service, so derivation / tally
   * ownership is unchanged (§G consolidation). `watchlistReadLimiter` is
   * preserved per §A7 (the same bucket the old route used — keys unchanged).
   */
  .get("/moods", async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(watchlistReadLimiter, c, userId);
    if (limited) return limited;
    const summary: WatchlistMoodSummary = await getMoodSummary(buildWatchlistContext(userId));
    return c.json(summary);
  })
  /**
   * Watchlist writes (design §A6): add / remove ride the media-owned writes
   * barrel (`addItem` / `removeItem`; media-owned since consolidation Phase 2).
   * `POST` returns `AddWatchlistResponse` (201 on a fresh insert, 200 when the
   * row was already active); `DELETE` is 204. `:type/:tmdbId` are path params.
   * `watchlistWriteLimiter` is preserved per §A7.
   */
  .post("/watchlist", zValidator("json", addWatchlistRequestSchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(watchlistWriteLimiter, c, userId);
    if (limited) return limited;
    const { tmdbId, mediaType, source } = c.req.valid("json");
    const result = await addItem({ tmdbId, mediaType }, source, buildWatchlistContext(userId));
    const body: AddWatchlistResponse = { item: result.item, wasActive: result.wasActive };
    return c.json(body, result.wasActive ? 200 : 201);
  })
  .delete("/watchlist/:type/:tmdbId", zValidator("param", watchlistWriteParamSchema), async (c) => {
    const userId = sessionUserId(c);
    const limited = rateLimitOrNull(watchlistWriteLimiter, c, userId);
    if (limited) return limited;
    const { type, tmdbId } = c.req.valid("param");
    await removeItem({ tmdbId, mediaType: type }, buildWatchlistContext(userId));
    return c.body(null, 204);
  });

/**
 * Decode the opaque outer cursor for one read, reproducing each consumer's V.CU1
 * behavior under one resolver (design §A3). `decode` never throws — bad/foreign/
 * mode-mismatched input returns `null` (invariant V.CU1).
 *
 * Home rows are static (`reg.cursorMode` equals the built source's mode), so the
 * cursor is decoded STRICTLY against it: an undecodable cursor maps to 400
 * (`cursorOnNull: "400"`), and a cursor-less seeded row (`requiresInitialCursor`)
 * is rejected with 400.
 *
 * `watchlist-items` is the one dynamic source — its mode flips keyset/offset on
 * `sort`/`bucket`/`mood`, so a static `reg.cursorMode` cannot describe a given
 * request. Watchlist therefore decodes LENIENTLY (no expected mode) and lets the
 * built source's own paginate stage fall a mode-mismatched cursor to the first
 * page — behaviorally identical to the old `readSection`, which decoded against
 * the built `source.stages.cursorMode` (`cursorOnNull: "firstPage"` → never 400).
 */
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
