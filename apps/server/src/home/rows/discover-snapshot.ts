import type { MediaSource } from "../../media";
import { makePipelineRow } from "../internal/pipeline";
import type { RowProvider } from "../internal/types";
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
  source: MediaSource<void, MediaKey>;
}): RowProvider {
  return makePipelineRow({
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    cursorMode: config.source.stages.cursorMode,
    source: config.source,
    params: undefined,
    async eligibility(ctx) {
      const { rows } = await config.source.fetchRawSet(ctx, undefined, null);
      return rows.length > 0;
    },
    initialCursor: async () => null,
    project: (ctx, rows) => loadCanonicalItems(ctx, rows),
  });
}
