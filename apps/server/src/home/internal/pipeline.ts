import type { RowKind } from "@nama/shared/home";
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
 * Wires home row through `media.listRows` (design §C/§H); `RowContext` is structurally
 * a superset of `SourceContext`, so seed source can stash `ctx.seedTitle` on it during
 * `fetchRawSet` and match-reason reads it back. Paginated rows project full set (pipeline
 * slices); bounded rows project single page (<= ROW_PAGE_SIZE) so pipeline mints `cursor:null`.
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
 * Assembles pipeline pieces (source, cursor config, enrich override) without running.
 * `loadRowPage` and `/api/media` resolver run separately; centralizing both here
 * keeps row → media wiring in one place (invariant V.A1: home-side) and stops drift.
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
