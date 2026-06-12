import type { ActiveRow, MediaRowBucket } from "@nama/shared/media";
import { keyToId } from "@nama/shared/watchlist";
import { getMatchingServersCached } from "../availability-cache";
import { classifyBucket, previewForClassify } from "../classify";
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

/**
 * The single bucket-classify pass (design §G): `batchLoad → classify`, skipping
 * the enrich/sort/paginate stages of the read pipeline. Walks each row once with
 * the shared status + metadata + progress fan-out plus the cached matching-server
 * probes — no artwork dispatch, no cold-fill — and pairs it with its bucket. The
 * read pipeline's classify stage consumes the pairing; the tonight source filters
 * the classified rows to the watchable buckets. This is the one definition of the
 * classify loop the watchlist `tonight/section` copy used to hand-roll.
 *
 * Probe failures fall back per-row (`Promise.allSettled` → "no servers") and the
 * status/metadata batches degrade to empty rather than throwing — a soft-failed
 * signal mis-buckets a single row, it never fails the whole pass. `partial` is
 * surfaced (from `batchLoad`); a caller that does not track it can discard it.
 */
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

  const classified = rows.map((row, i): ClassifiedRow => {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const preview = previewForClassify(
      metadata[composite],
      statuses[composite],
      servers,
      progress.get(composite),
    );
    return { row, bucket: classifyBucket(preview) };
  });

  return { classified, partial };
}
