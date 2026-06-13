import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { ActiveRow } from "@nama/shared/media";
import type { SourceContext } from "../../media";

/**
 * Batch-load canonical metadata for `rows`, warning + degrading to an empty map
 * (and flagging `partial`) on failure rather than throwing. Shared by the
 * watchlist sources that read catalog metadata source-side — the mood predicate
 * (`mood-items`) and the alpha/runtime sort (`items`) — so both load it the same
 * way. `logTag` distinguishes the warning's source in the logs.
 */
export async function loadRowMetadata(
  ctx: Pick<SourceContext, "catalog" | "logger">,
  rows: ActiveRow[],
  logTag: string,
): Promise<{ map: Record<string, CanonicalMetadata>; partial: boolean }> {
  let partial = false;
  const map = await ctx.catalog
    .getMetadataBatch(rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType })))
    .catch((err) => {
      ctx.logger.warn(`[watchlist:${logTag}] metadata batch failed`, err);
      partial = true;
      return {} as Record<string, CanonicalMetadata>;
    });
  return { map, partial };
}
