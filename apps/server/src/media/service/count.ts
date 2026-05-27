import type { ActiveRow, MediaRowBucket } from "@ent-mcp/shared/media";
import type { BatchLoadContext } from "../pipeline/batch-load";
import { classifyRows } from "./classify-rows";

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
 * Count-mode aggregate (design §G): classify every active row once via the
 * shared `classifyRows` pass and tally the bucket each row lands in, skipping
 * the enrich/sort/paginate stages of the read pipeline. Empty input does no
 * plugin work (the `classifyRows` short-circuit). `partial` is discarded — the
 * `WatchlistCounts` wire shape has no partial field, matching the pre-refactor
 * `getCounts` which never surfaced it.
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

  const { classified } = await classifyRows(rows, ctx);
  for (const { bucket } of classified) counts[bucket]++;

  return counts;
}
