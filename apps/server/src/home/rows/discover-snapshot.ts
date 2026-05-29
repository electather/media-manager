import type { DiscoverFeedKind, DiscoverSort } from "@ent-mcp/shared/catalog";
import type { MediaSource } from "../../media";
import { makePipelineRow } from "../internal/pipeline";
import type { RowProvider } from "../internal/types";
import { todayBucket } from "../sources/discover-snapshot";
import { loadCanonicalItems, type MediaKey } from "./_shared";

/**
 * Reads from `discover_snapshots` via its `MediaSource` (the raw-set producer;
 * design §H/§M.5) and runs the row through the shared media pipeline
 * (`makePipelineRow` → `media.listRows`), which owns the offset slice + cursor.
 * The catalog is the source of truth for trending/new-releases, so this row
 * never partials — failures land as `eligibility=false` (no snapshot for the
 * day) and the row drops cleanly. The row projects the full snapshot; the
 * pipeline slices.
 */
export function makeDiscoverSnapshotRow(config: {
  rowId: string;
  kind: "trendingNow" | "newReleases";
  titleKey: string;
  feedKind: DiscoverFeedKind;
  sort: DiscoverSort;
  source: MediaSource<void, MediaKey>;
}): RowProvider {
  return makePipelineRow({
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    cursorMode: config.source.stages.cursorMode,
    source: config.source,
    params: undefined,
    // Probe the day-bucketed row's existence directly instead of running the
    // source's `fetchRawSet` here — `load` will call `fetchRawSet` again, and
    // the snapshot's items array is a non-trivial deserialize on a hot path
    // (every home-layout render that includes this row).
    eligibility: (ctx) => ctx.catalog.hasDiscoverFeed(config.feedKind, config.sort, todayBucket()),
    initialCursor: async () => null,
    project: (ctx, rows) => loadCanonicalItems(ctx, rows),
  });
}
