import type { ActiveRow, MediaRowBucket } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import { getMatchingServersCached } from "../availability-cache";
import { classifyBucket, previewForClassify } from "../classify";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";
import type { MatchingServer } from "../types";

/**
 * A tally of how many rows fall into each of the five visible media buckets.
 * The pure domain shape (keyed by `MediaRowBucket`); the watchlist `getCounts`
 * envelope maps it onto the `WatchlistCounts` wire shape (`in-progress` →
 * `inProgress`, plus `total`).
 */
export type BucketCounts = Record<MediaRowBucket, number>;

/**
 * Per-call surface `countBuckets` needs: the shared fan-out context plus the
 * `userId` the matching-server probe is keyed by. The watchlist `WatchlistContext`
 * satisfies it structurally.
 */
export interface CountBucketsContext extends BatchLoadContext {
  userId: string;
}

/**
 * Count-mode aggregate (design §G): `batchLoad → classify → tally`, skipping the
 * enrich/sort/paginate stages of the read pipeline. Walks each active row once
 * with the shared status + metadata + progress fan-out plus cached matching-server
 * probes — no artwork dispatch, no cold-fill — and tallies the bucket each row
 * classifies into. This is the single definition of the bucket-classify count
 * loop that the watchlist `getCounts` copy used to hand-roll.
 */
export async function countBuckets(
  rows: ReadonlyArray<ActiveRow>,
  ctx: CountBucketsContext,
): Promise<BucketCounts> {
  const counts: BucketCounts = {
    ready: 0,
    "in-progress": 0,
    awaiting: 0,
    unavailable: 0,
    upcoming: 0,
  };
  if (rows.length === 0) return counts;

  const { statuses, metadata, progress } = await batchLoad(rows, ctx);

  // Matching-server probes are request-shared via the availability cache, so the
  // paired `/watchlist` + `/watchlist/counts` round-trip pays one probe per row.
  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(ctx.userId, ctx.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const preview = previewForClassify(
      metadata[composite],
      statuses[composite],
      servers,
      progress.get(composite),
    );
    counts[classifyBucket(preview)]++;
  }

  return counts;
}
