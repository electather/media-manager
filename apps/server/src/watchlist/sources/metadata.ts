import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { ActiveRow } from "@nama/shared/media";
import type { SourceContext } from "../../media";

/**
 * Batch-load metadata for rows. On failure: warn, degrade to empty map, flag `partial`.
 * Shared by mood-items and items sources. `logTag` distinguishes log source.
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
