import { z } from "zod";
import { decodeCursor, encodeCursor } from "../cursor";
import type { CanonicalMetadata, DiscoverFeedKind, DiscoverSort } from "../../catalog/types";
import { fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowContext, RowPage, RowProvider } from "../types";

const PAGE_SIZE = 12;
const cursorSchema = z.object({ offset: z.number().int().min(0) });

/** UTC midnight epoch ms — keys the day-bucketed `discover_snapshots` table. */
function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Reads from `discover_snapshots`. The catalog is the source of truth for
 * trending/new-releases, so this row never partials — failures land as
 * `eligibility=false` (no snapshot for the day) and the row drops cleanly.
 */
export function makeDiscoverSnapshotRow(config: {
  rowId: string;
  kind: "trendingNow" | "newReleases";
  titleKey: string;
  feedKind: DiscoverFeedKind;
  sort: DiscoverSort;
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    async eligibility(ctx) {
      const snap = await ctx.catalog.getDiscoverFeed(config.feedKind, config.sort, todayBucket());
      return snap !== null && snap.length > 0;
    },
    async initialCursor() {
      return null;
    },
    async fetchPage(ctx, cursor) {
      return fetchPage(ctx, cursor, config);
    },
  };
}

async function fetchPage(
  ctx: RowContext,
  cursor: string | null,
  config: { feedKind: DiscoverFeedKind; sort: DiscoverSort },
): Promise<RowPage> {
  const page = cursor === null ? { offset: 0 } : decodeCursor(cursor, cursorSchema);
  const snap = await ctx.catalog.getDiscoverFeed(config.feedKind, config.sort, todayBucket());
  if (!snap) return { items: [], cursor: null, partial: false };
  const slice = snap.slice(page.offset, page.offset + PAGE_SIZE);
  const metadata = await ctx.catalog.getMetadataBatch(slice);
  const items: InternalCompactMediaItem[] = [];
  for (const k of slice) {
    const meta = metadata[`${k.type}:${k.tmdbId}`] as CanonicalMetadata | undefined;
    if (meta) items.push(fromCanonicalMetadata(meta));
  }
  const next =
    snap.length > page.offset + PAGE_SIZE
      ? encodeCursor({ offset: page.offset + PAGE_SIZE })
      : null;
  return { items, cursor: next, partial: false };
}
