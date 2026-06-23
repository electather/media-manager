import { consola } from "consola";
import type { SourceContext } from "../../media";
import type { LibraryContext, MaybeLibraryContext } from "../types";

/** Coalesces loose context into LibraryContext. Accepts logger or log; defaults to consola. */
export function asLibraryContext(ctx: MaybeLibraryContext): LibraryContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    deadlineMs: ctx.deadlineMs,
    log: ctx.log ?? ctx.logger ?? consola,
  };
}

/** Bridges SourceContext from unified resolver to LibraryContext for enrich hook. Read-path analogue of asLibraryContext. */
export function asLibraryReadContext(ctx: SourceContext): LibraryContext {
  return asLibraryContext({
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    ...(ctx.deadlineMs != null ? { deadlineMs: ctx.deadlineMs } : {}),
    logger: ctx.logger,
  });
}
