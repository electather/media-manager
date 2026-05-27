import type { RowKind } from "@ent-mcp/shared/home";
import {
  listRows,
  type Cursor,
  type CursorMode,
  type MediaSource,
  type Page,
  type PipelineConfig,
} from "../../media";
import { ROW_PAGE_SIZE } from "../rows/_shared";
import { enrichHomeItems } from "./media-enrichment";
import type { InternalCompactMediaItem, RowContext, RowProvider } from "./types";

type RowProjection<Row> = (
  ctx: RowContext,
  rows: Row[],
) => InternalCompactMediaItem[] | Promise<InternalCompactMediaItem[]>;

/**
 * The home → media pipeline bridge. Kept here (not in `rows/_shared`) so the
 * env-free `rows/_shared` helpers (`loadCanonicalItems`, `probeMediaEntry`) and
 * the source unit tests that import them never pull the heavy `media → db → env`
 * graph that `listRows` + `enrichHomeItems` drag in.
 */

/**
 * Run a home row through the shared media pipeline (`media.listRows`, design
 * §C/§H). The row supplies its `MediaSource` (raw rows only), the request
 * `params`, and a `project` that maps those raw rows to enrichable compact
 * items; `loadRowPage` wires the home enrichment (`enrichHomeItems`, which adds
 * the row-aware match-reason chip) in as the pipeline's enrich override and lets
 * the pipeline own sort/filter/slice/cursor.
 *
 * The `RowContext` is passed straight through as the media `SourceContext` (it
 * is structurally a superset), so a seed source can stash `ctx.seedTitle` on it
 * during `fetchRawSet` and the match-reason callback reads it back off the same
 * object.
 *
 * Paginated rows `project` the full raw set (the pipeline slices); bounded rows
 * `project` a single page (`<= ROW_PAGE_SIZE`) so the pipeline mints `cursor:null`.
 */
export function loadRowPage<P, Row>(
  ctx: RowContext,
  spec: {
    rowId: string;
    source: MediaSource<P, Row>;
    params: P;
    cursor: Cursor | null;
    pageSize: number;
    project: RowProjection<Row>;
  },
): Promise<Page> {
  const cfg: PipelineConfig<P> = { params: spec.params, cursor: spec.cursor, limit: spec.pageSize };
  return listRows(spec.source, cfg, ctx, async (rows) =>
    enrichHomeItems(await spec.project(ctx, rows), ctx, { rowId: spec.rowId }),
  );
}

/**
 * Builds a `RowProvider` whose `load` runs the source through the shared media
 * pipeline (`loadRowPage`). Centralizes the provider scaffold so every row —
 * the simple ones plus the `makeBoundedRow` / `makeDiscoverSnapshotRow` /
 * `makeRecommendedForYou` factories — declares only what differs (eligibility,
 * the seed cursor, the source/params, and the raw-row projection) and shares
 * one `load` wiring.
 */
export function makePipelineRow<P, Row>(config: {
  rowId: string;
  kind: RowKind;
  titleKey: string;
  eyebrowKey?: string;
  cursorMode: CursorMode;
  requiresInitialCursor?: boolean;
  pageSize?: number;
  source: MediaSource<P, Row>;
  params: P;
  eligibility: (ctx: RowContext) => Promise<boolean>;
  initialCursor: (ctx: RowContext) => Promise<string | null>;
  project: RowProjection<Row>;
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    ...(config.requiresInitialCursor ? { requiresInitialCursor: true } : {}),
    cursorMode: config.cursorMode,
    eligibility: config.eligibility,
    initialCursor: config.initialCursor,
    load(ctx, cursor) {
      return loadRowPage(ctx, {
        rowId: config.rowId,
        source: config.source,
        params: config.params,
        cursor,
        pageSize: config.pageSize ?? ROW_PAGE_SIZE,
        project: config.project,
      });
    },
  };
}

/**
 * Builds a bounded (cursor-less) capability-gated row from a `MediaSource`.
 * The `continueWatching-next` and `upcomingForYou` rows ship one page and never
 * paginate, so they share the same provider shape — `eligibility` flips on a
 * capability provider, `initialCursor` is null, and the `project` slices to a
 * single page so the pipeline mints `cursor: null`. Only the capability,
 * source, and per-row projection differ, so they pass them as config (mirrors
 * `makeDiscoverSnapshotRow` / `makeRecommendedForYou`).
 */
export function makeBoundedRow<Row>(config: {
  rowId: string;
  kind: RowKind;
  titleKey: string;
  eyebrowKey?: string;
  capability: string;
  source: MediaSource<void, Row>;
  project: RowProjection<Row>;
}): RowProvider {
  return makePipelineRow({
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    cursorMode: config.source.stages.cursorMode,
    source: config.source,
    params: undefined,
    eligibility: (ctx) => ctx.mediaService.hasCapabilityProvider(config.capability, "v1", "user"),
    initialCursor: async () => null,
    project: config.project,
  });
}
