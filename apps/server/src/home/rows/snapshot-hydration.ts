import { compact } from "es-toolkit/array";
import { isNil } from "es-toolkit/predicate";
import type { CanonicalMetadata, MetadataKey } from "../../catalog/types";
import type { DiscoverFeedKind, DiscoverSort } from "../../catalog/types";
import { canonicalToRaw } from "../compact";
import { encodeCursor } from "../cursor";
import { buildItem } from "./build-item";
import type { RowFetchContext, RowFetchResult } from "./index";

type SnapshotRowId = "trendingNow" | "newReleases";

interface SnapshotHydrationOptions {
  rowId: SnapshotRowId;
  refs: MetadataKey[];
  page: number;
  limit: number;
  maxItems: number;
}

interface DiscoverSnapshotLookupOptions {
  rowId: SnapshotRowId;
  feedKind: DiscoverFeedKind;
  sort: DiscoverSort;
  day: number;
  page: number;
  limit: number;
  maxItems: number;
}

/**
 * Looks up the daily discover snapshot for a row and, on hit, hydrates it
 * via `hydrateFromSnapshot`. Returns `null` on a miss so the caller can
 * fall back to its live plugin path.
 */
export async function tryHydrateFromDiscoverSnapshot(
  ctx: RowFetchContext,
  opts: DiscoverSnapshotLookupOptions,
): Promise<RowFetchResult | null> {
  const snapshot = await ctx.catalogService.getDiscoverFeed(opts.feedKind, opts.sort, opts.day);
  if (!snapshot || snapshot.length === 0) return null;
  return hydrateFromSnapshot(ctx, {
    rowId: opts.rowId,
    refs: snapshot,
    page: opts.page,
    limit: opts.limit,
    maxItems: opts.maxItems,
  });
}

/**
 * Shared catalog-snapshot reader used by `newReleases` and `trendingNow`.
 * Slices the snapshot to the requested page, batches a canonical-metadata
 * lookup, and emits compacts from `canonicalToRaw` so persisted poster /
 * backdrop / clearLogo URLs flow onto the wire even when the live plugin
 * for the row never returns artwork.
 */
// fallow-ignore-next-line complexity
export async function hydrateFromSnapshot(
  ctx: RowFetchContext,
  opts: SnapshotHydrationOptions,
): Promise<RowFetchResult> {
  const { rowId, refs, page, limit, maxItems } = opts;
  const start = page * limit;
  const slice = refs.slice(start, start + limit);
  if (slice.length === 0) {
    return { items: [], cursor: null };
  }

  const rows = await ctx.catalogService.getMetadataBatch(slice);
  const hydrated: Array<CanonicalMetadata | null> = slice.map(
    (ref) => rows[`${ref.type}:${ref.tmdbId}`] ?? null,
  );
  const isPartial = hydrated.some(isNil);
  const present = compact(hydrated);

  const items = await Promise.all(present.map((row) => buildItem(ctx, canonicalToRaw(row))));
  const usable = compact(items);

  const nextStart = start + limit;
  const reachedCap = nextStart >= maxItems;
  const exhausted = nextStart >= refs.length;
  const cursor =
    exhausted || reachedCap || usable.length === 0
      ? null
      : encodeCursor(rowId, { v: 1, r: rowId, p: page + 1 });
  return isPartial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
}
