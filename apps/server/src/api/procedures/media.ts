import { Hono } from "hono";
import { consola } from "consola";
import { z } from "zod";
import { mediaTypeSchema } from "@ent-mcp/shared/media";
import { requireSession, sessionUserId } from "../../auth";
import { ArtworkService } from "../../artwork";
import { getCatalogService, toCanonicalRow } from "../../catalog";
import {
  decode,
  listRows,
  MediaService,
  StatusBatchMemo,
  type AnyMediaSourceRegistration,
  type Cursor,
  type SourceContext,
} from "../../media";
import {
  buildContext as buildHomeContext,
  composeDetails,
  composeSeasonAvailability,
  homeMediaSources,
} from "../../home";
import { watchlistMediaSources } from "../../watchlist";
import { badRequest, notFound } from "../../diagnostics/http-errors";
import { zValidator } from "../../diagnostics/validator";
import { rateLimitOrNull } from "../rate-limit";
import { watchlistReadLimiter, watchlistWriteLimiter } from "./watchlist";

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

/** Maps a registration's declared `rateLimit` to the limiter instance (design §A7). */
const limiterFor = { read: watchlistReadLimiter, write: watchlistWriteLimiter } as const;

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
  .get("/sources/:sourceId", async (c) => {
    const sourceId = c.req.param("sourceId");
    const reg = REGISTRY[sourceId];
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
