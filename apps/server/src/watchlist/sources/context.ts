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
 * The resolved per-request handles a watchlist source needs to build a media
 * `SourceContext`. It mirrors the fields `asWatchlistContext` already resolves
 * (`service.ts`), so the section envelope passes its `ResolvedWatchlistContext`
 * straight through structurally.
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
 * Bridge a resolved watchlist context onto the media `SourceContext` that
 * `listRows` and a `MediaSource` expect (design §B/§M.4): map `log → logger`
 * and mint a fresh request-scoped `StatusBatchMemo`. Shared by every watchlist
 * source (items / mood-items / tonight / recently) so each section envelope
 * builds the context the same way.
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
