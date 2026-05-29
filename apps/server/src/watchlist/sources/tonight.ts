import type { ActiveRow, MediaRowBucket } from "@ent-mcp/shared/media";
import {
  classifyRows,
  listAllActiveRows,
  type ClassifyRowsContext,
  type Cursor,
  type MediaSource,
  type PipelineConfig,
  type SourceContext,
} from "../../media";

/**
 * The only buckets a row can be watched *tonight* from: `ready` (a library copy
 * exists) or `in-progress` (continue-watching). Awaiting / upcoming /
 * unavailable rows are excluded before ranking — they cannot be played now and
 * the tonight `score` would penalize them to the floor anyway.
 */
const TONIGHT_BUCKETS = new Set<MediaRowBucket>(["ready", "in-progress"]);

/**
 * Tonight enriches the FULL candidate set (the `score`/`pick` heuristic reads
 * enriched fields — status, availability, runtime, genres, progress — so it can
 * only run after the pipeline enriches) and the envelope reduces it to a hero +
 * ≤4 alternates. So the pipeline must not truncate the page before `pick` runs.
 * The candidate set is already bounded (the active watchlist filtered to
 * watchable buckets), so a concrete ceiling well above any plausible watchlist
 * size serves the whole bounded set in one slice. We use a finite ceiling
 * rather than `Number.MAX_SAFE_INTEGER` so the only signal we get above it
 * is `paginate`'s advisory `OFFSET_FULL_LOAD_WARN` — not a spurious warn on
 * every tonight load for users brushing the 1000-row mark.
 */
export const TONIGHT_PAGE_LIMIT = 10_000;

/**
 * The watchlist `tonight` `MediaSource` (design §S.2 / consolidation §H). The
 * source runs the cheap classify pre-filter over the active set inside
 * `fetchRawSet` (the shared `classifyRows` pass) and returns ONLY the rows in a
 * watchable bucket as raw `ActiveRow`s, so the pipeline does not enrich a
 * 1000-row backlog just to find the top five. It supplies only raw rows + a
 * `stages` declaration (V.MC1); the media pipeline (`listRows`) owns enrich /
 * paginate, and the watchlist-product ranking (`score`/`pick`) runs in the
 * section envelope over the flat enriched page (V.TN1 — hero/alternate split
 * stays envelope-side).
 *
 * `stages.sort: "none"` because the envelope's `pick` does the ordering; the
 * page is bounded so the keyset cursor mode is never exercised (no cursor).
 */
export const tonightSource: MediaSource<void> = {
  sourceId: "watchlist.tonight",
  fetchRawSet: fetchTonightRawSet,
  stages: { sort: "none", cursorMode: "keyset" },
};

/** Pipeline config for the tonight read: the whole bounded candidate set, no cursor. */
export function tonightCfg(): PipelineConfig<void> {
  return { params: undefined, cursor: null, limit: TONIGHT_PAGE_LIMIT };
}

/**
 * Classify the active set and keep only the watchable rows. The pre-filter's
 * soft failures are swallowed here (`partial: false`) as the pre-refactor
 * `getSection` did; the page's `partial` comes from the pipeline's own
 * `batchLoad` + enrich (`listRows`).
 */
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
