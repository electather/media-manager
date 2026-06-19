import { consola } from "consola";
import type { SourceContext } from "../../media";
import type { LibraryContext, MaybeLibraryContext } from "../types";

/**
 * Resolves a loose per-request context into the canonical `LibraryContext`.
 * Mirrors `watchlist/internal/context.ts#asWatchlistContext`: the home row
 * context names its logger `logger`, the section envelopes name it `log`, so
 * both are accepted and collapsed onto `log` (falling back to the shared
 * `consola` singleton). Phase 1 membership sync needs nothing beyond the
 * handles already present on the loose shape, so this is a straight projection.
 */
export function asLibraryContext(ctx: MaybeLibraryContext): LibraryContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    deadlineMs: ctx.deadlineMs,
    log: ctx.log ?? ctx.logger ?? consola,
  };
}

/**
 * Bridges the media `SourceContext` the unified resolver hands a source into the
 * resolved library read context the enrich hook consumes. The resolver names its
 * logger `logger`; `asLibraryContext` collapses that onto `log`. This is the read
 * analogue of `asLibraryContext` for the sync path — a source's `fetchRawSet`
 * gets a `SourceContext`, so the eager-seed + enrich helpers resolve it here.
 */
export function asLibraryReadContext(ctx: SourceContext): LibraryContext {
  return asLibraryContext({
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    ...(ctx.deadlineMs != null ? { deadlineMs: ctx.deadlineMs } : {}),
    logger: ctx.logger,
  });
}
