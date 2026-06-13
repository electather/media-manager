import type { ConsolaInstance } from "consola";
import { consola } from "consola";
import { WATCHLIST_LIST_DEFAULT_LIMIT, WATCHLIST_LIST_MAX_LIMIT } from "@nama/shared/watchlist";
import { ArtworkService } from "../../artwork";
import { toCanonicalRow, type CatalogService } from "../../catalog";
import {
  loadProgressMap,
  type GetArtworkFn,
  type MediaService,
  type ToCanonicalRowFn,
} from "../../media";

/**
 * Per-request context. Structurally compatible with the home row context so
 * `home/rows/your-watchlist.ts` can pass its existing `RowContext`.
 */
export interface WatchlistContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log: ConsolaInstance;
}

/**
 * The fully-resolved per-request handles every read path needs: the bare
 * `WatchlistContext` plus the media cycle-breaker callbacks (`getArtwork`,
 * `toCanonicalRow`) and the progress loader. `toSourceContext` (sources) and
 * the section envelopes consume this shape.
 */
export interface ResolvedWatchlistContext extends WatchlistContext {
  loadProgressMap: typeof loadProgressMap;
  getArtwork: GetArtworkFn;
  toCanonicalRow: ToCanonicalRowFn;
}

/**
 * The loose per-request context the public endpoints accept. `log`/`logger`
 * are interchangeable so a home `RowContext` (which names it `logger`) flows in
 * unchanged; `asWatchlistContext` resolves it into the canonical shape.
 */
export interface MaybeRowContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log?: ConsolaInstance;
  logger?: ConsolaInstance;
}

export function asWatchlistContext(ctx: MaybeRowContext): ResolvedWatchlistContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    deadlineMs: ctx.deadlineMs,
    log: ctx.log ?? ctx.logger ?? consola,
    loadProgressMap,
    getArtwork: (requests) => new ArtworkService(ctx.userId, ctx.catalog).getArtwork(requests),
    toCanonicalRow,
  };
}

export function clampLimit(value: number | undefined): number {
  if (value == null) return WATCHLIST_LIST_DEFAULT_LIMIT;
  if (value <= 0) return WATCHLIST_LIST_DEFAULT_LIMIT;
  return Math.min(value, WATCHLIST_LIST_MAX_LIMIT);
}
