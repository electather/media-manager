import type { RowKind } from "@ent-mcp/shared/home";
import {
  listRows,
  type BuiltMediaSource,
  type Cursor,
  type CursorMode,
  type MediaSource,
  type Page,
  type SourceContext,
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
interface RowPipelineSpec<P, Row> {
  rowId: string;
  source: MediaSource<P, Row>;
  params: P;
  cursor: Cursor | null;
  pageSize: number;
  project: RowProjection<Row>;
}

/**
 * Assemble the pieces a home row feeds `media.listRows` — the source, the
 * decoded-cursor config, and the home enrich override (which adds the row-aware
 * match-reason chip) — WITHOUT running them. `loadRowPage` runs them; the
 * `/api/media` resolver (via `RowProvider.buildPipeline` → `homeMediaSources`)
 * runs them itself. Defining both atop this one helper keeps the row → media
 * wiring in one place (invariant V.A1: it stays home-side) and stops `load` and
 * the registry path from drifting.
 */
export function buildRowPipeline<P, Row>(
  ctx: RowContext,
  spec: RowPipelineSpec<P, Row>,
): Required<BuiltMediaSource<P, Row>> {
  return {
    source: spec.source,
    cfg: { params: spec.params, cursor: spec.cursor, limit: spec.pageSize },
    enrichRows: async (rows) =>
      enrichHomeItems(await spec.project(ctx, rows), ctx, { rowId: spec.rowId }),
  };
}

export function loadRowPage<P, Row>(ctx: RowContext, spec: RowPipelineSpec<P, Row>): Promise<Page> {
  const { source, cfg, enrichRows } = buildRowPipeline(ctx, spec);
  // `satisfies SourceContext` machine-checks the prose claim above — TS now
  // breaks the build if a future narrowing removes a required SourceContext
  // field from RowContext, instead of silently falling through to a runtime
  // surprise inside listRows.
  const mediaCtx = ctx satisfies SourceContext;
  return listRows(source, cfg, mediaCtx, enrichRows);
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
  const specFor = (cursor: Cursor | null): RowPipelineSpec<P, Row> => ({
    rowId: config.rowId,
    source: config.source,
    params: config.params,
    cursor,
    pageSize: config.pageSize ?? ROW_PAGE_SIZE,
    project: config.project,
  });
  return {
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    ...(config.requiresInitialCursor ? { requiresInitialCursor: true } : {}),
    cursorMode: config.cursorMode,
    eligibility: config.eligibility,
    initialCursor: config.initialCursor,
    buildPipeline: (ctx, cursor) => buildRowPipeline(ctx, specFor(cursor)),
    load: (ctx, cursor) => loadRowPage(ctx, specFor(cursor)),
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
