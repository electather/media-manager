import type { DiscoverFeedKind, DiscoverSort } from "@nama/shared/catalog";
import type { MediaSource } from "../../media";
import { makePipelineRow } from "../internal/pipeline";
import type { RowProvider } from "../internal/types";
import { todayBucket } from "../sources/discover-snapshot";
import { loadCanonicalItems, type MediaKey } from "./_shared";

/**
 * Reads from `discover_snapshots` via `MediaSource` (design §H/§M.5) through shared media pipeline
 * (`makePipelineRow` → `media.listRows`). Catalog is source of truth, so never partials — failures
 * become `eligibility=false` and row drops cleanly. Row projects full snapshot; pipeline slices.
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
