import { z } from "zod";
import { decodeCursor, encodeCursor } from "../internal/cursor";
import type { MediaSource } from "../../media";
import type { RowProvider } from "../internal/types";
import { loadCanonicalItems, type MediaKey } from "./_shared";

const PAGE_SIZE = 12;
const cursorSchema = z.object({ offset: z.number().int().min(0) });

/**
 * Reads from `discover_snapshots` via its `MediaSource` (the raw-set producer;
 * design §H/§M.5). The catalog is the source of truth for trending/new-releases,
 * so this row never partials — failures land as `eligibility=false` (no snapshot
 * for the day) and the row drops cleanly. The offset slice + cursor still live
 * here until US-022 folds them into the shared pipeline.
 */
export function makeDiscoverSnapshotRow(config: {
  rowId: string;
  kind: "trendingNow" | "newReleases";
  titleKey: string;
  source: MediaSource<void, MediaKey>;
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    async eligibility(ctx) {
      const { rows } = await config.source.fetchRawSet(ctx, undefined, null);
      return rows.length > 0;
    },
    async initialCursor() {
      return null;
    },
    async fetchPage(ctx, cursor) {
      const page = cursor === null ? { offset: 0 } : decodeCursor(cursor, cursorSchema);
      const { rows } = await config.source.fetchRawSet(ctx, undefined, null);
      const slice = rows.slice(page.offset, page.offset + PAGE_SIZE);
      const items = await loadCanonicalItems(ctx, slice);
      const next =
        rows.length > page.offset + PAGE_SIZE
          ? encodeCursor({ offset: page.offset + PAGE_SIZE })
          : null;
      return { items, cursor: next, partial: false };
    },
  };
}
