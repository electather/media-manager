import type { ConsolaInstance } from "consola";
import type { CatalogService } from "../../catalog";
import {
  StatusBatchMemo,
  type GetArtworkFn,
  type MediaService,
  type SourceContext,
  type ToCanonicalRowFn,
} from "../../media";

/**
 * Resolved per-request handles for watchlist source `SourceContext`. Mirrors fields from
 * `asWatchlistContext` (`service.ts`) so the envelope passes `ResolvedWatchlistContext` through structurally.
 */
export interface WatchlistSourceCtx {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log: ConsolaInstance;
  getArtwork: GetArtworkFn;
  toCanonicalRow: ToCanonicalRowFn;
}

/**
 * Bridge watchlist context to media `SourceContext` (design §B/§M.4): map `log → logger`,
 * mint request-scoped `StatusBatchMemo`. Used by all watchlist sources so envelopes build consistently.
 */
export function toSourceContext(c: WatchlistSourceCtx): SourceContext {
  return {
    userId: c.userId,
    mediaService: c.mediaService,
    catalog: c.catalog,
    ...(c.deadlineMs !== undefined ? { deadlineMs: c.deadlineMs } : {}),
    statusBatch: new StatusBatchMemo(c.mediaService),
    logger: c.log,
    getArtwork: c.getArtwork,
    toCanonicalRow: c.toCanonicalRow,
  };
}
