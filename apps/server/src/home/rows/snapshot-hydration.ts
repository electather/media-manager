import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { isNil } from "es-toolkit/predicate";
import type { CanonicalMetadata, MetadataKey } from "../../catalog/types";
import { canonicalToRaw } from "../compact";
import { encodeCursor } from "../cursor";
import { buildItem } from "./build-item";
import type { RowFetchContext, RowFetchResult } from "./index";

interface SnapshotHydrationOptions {
  rowId: "trendingNow" | "newReleases";
  refs: MetadataKey[];
  page: number;
  limit: number;
  maxItems: number;
}

/**
 * Shared catalog-snapshot reader used by `newReleases` and `trendingNow`.
 * Slices the snapshot to the requested page, batches a canonical-metadata
 * lookup, and emits compacts from `canonicalToRaw` so persisted poster /
 * backdrop / clearLogo URLs flow onto the wire even when the live plugin
 * for the row never returns artwork.
 */
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
  const present = hydrated.filter((row): row is CanonicalMetadata => row !== null);

  const items = await Promise.all(present.map((row) => buildItem(ctx, canonicalToRaw(row))));
  const usable = items.filter((item): item is CompactMediaItem => item !== null);

  const nextStart = start + limit;
  const reachedCap = nextStart >= maxItems;
  const exhausted = nextStart >= refs.length;
  const cursor =
    exhausted || reachedCap || usable.length === 0
      ? null
      : encodeCursor(rowId, { v: 1, r: rowId, p: page + 1 });
  return isPartial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
}
