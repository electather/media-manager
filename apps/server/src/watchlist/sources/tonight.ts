import type { ActiveRow, MediaRowBucket } from "@nama/shared/media";
import {
  classifyRows,
  listAllActiveRows,
  type ClassifyRowsContext,
  type Cursor,
  type MediaSource,
  type PipelineConfig,
  type SourceContext,
} from "../../media";

// Only `ready` (library copy exists) and `in-progress` (continue-watching) rows can be watched tonight; others (awaiting/upcoming/unavailable) lack playable content now
const TONIGHT_BUCKETS = new Set<MediaRowBucket>(["ready", "in-progress"]);

// Ceiling above any plausible watchlist to load the whole bounded set in one slice. Finite rather than MAX_SAFE_INTEGER so `OFFSET_FULL_LOAD_WARN` signals honestly (avoids spurious 1000-row warns). Pipeline must not truncate before `pick` runs; `score`/`pick` read enriched fields (status, availability, runtime, genres, progress).
export const TONIGHT_PAGE_LIMIT = 10_000;

// Watchlist `tonight` MediaSource (design §S.2, consolidation §H). Cheap classify pre-filter runs in fetchRawSet (classifyRows), returns only watchable ActiveRows so pipeline doesn't enrich a 1000-row backlog. Supplies raw rows + stages declaration (V.MC1); listRows owns enrich/paginate, score/pick runs in envelope (V.TN1). stages.sort="none" because envelope picks ordering; bounded set means no cursor needed (keyset mode never exercised).
export const tonightSource: MediaSource<void> = {
  sourceId: "watchlist.tonight",
  fetchRawSet: fetchTonightRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/** Pipeline config for the tonight read: the whole bounded candidate set, no cursor. */
export function tonightCfg(): PipelineConfig<void> {
  return { params: undefined, cursor: null, limit: TONIGHT_PAGE_LIMIT };
}

// Classify active set, keep only watchable rows. Soft failures swallowed here (partial: false) like pre-refactor getSection; page's partial comes from pipeline's batchLoad + enrich (listRows).
async function fetchTonightRawSet(
  ctx: SourceContext,
  _params: void,
  _cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  const rows = await listAllActiveRows(ctx.userId);
  if (rows.length === 0) return { rows: [], partial: false };

  const { classified } = await classifyRows(rows, toClassifyContext(ctx));
  const candidates = classified.filter((c) => TONIGHT_BUCKETS.has(c.bucket)).map((c) => c.row);
  return { rows: candidates, partial: false };
}

/** Bridge the unified `SourceContext` onto the `classifyRows` surface (`logger` → `log`). */
function toClassifyContext(ctx: SourceContext): ClassifyRowsContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    log: ctx.logger,
    ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
  };
}
