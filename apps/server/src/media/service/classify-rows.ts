import type { ActiveRow, MediaRowBucket } from "@nama/shared/media";
import { keyToId } from "@nama/shared/watchlist";
import { getMatchingServersCached } from "../availability-cache";
import { classifyBucket, previewForClassify } from "../classify";
import { capabilityRegistry } from "../../plugin-runtime";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";
import type { MatchingServer } from "../types";

/**
 * Per-call surface `classifyRows` needs: the shared fan-out context plus the
 * `userId` the matching-server probe is keyed by. The read pipeline's classify
 * stage and the watchlist `tonight` source satisfy it structurally.
 */
export interface ClassifyRowsContext extends BatchLoadContext {
  userId: string;
}

/** A raw row paired with the bucket it classifies into. */
export interface ClassifiedRow {
  row: ActiveRow;
  bucket: MediaRowBucket;
}

// Single bucket-classify pass (design §G): batchLoad + classify, skipping enrich/
// sort/paginate. Per-row probes fallback via allSettled; status/metadata batches
// degrade to empty (soft-failed row mis-buckets, never fails whole pass).
export async function classifyRows(
  rows: ReadonlyArray<ActiveRow>,
  ctx: ClassifyRowsContext,
): Promise<{ classified: ClassifiedRow[]; partial: boolean }> {
  if (rows.length === 0) return { classified: [], partial: false };

  const { statuses, metadata, progress, partial } = await batchLoad(rows, ctx);

  // Matching-server probes are request-shared via the availability cache, so a
  // list + section round-trip pays one probe per row.
  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(ctx.userId, ctx.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  const requestProviderCount = capabilityRegistry.listProviders(
    "mediaRequest",
    "v1",
    "user",
  ).length;
  const classified = rows.map((row, i): ClassifiedRow => {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const preview = previewForClassify(
      metadata[composite],
      statuses[composite],
      servers,
      progress.get(composite),
      requestProviderCount,
    );
    return { row, bucket: classifyBucket(preview) };
  });

  return { classified, partial };
}
