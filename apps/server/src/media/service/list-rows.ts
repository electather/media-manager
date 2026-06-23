import type { CompactMediaItem } from "@nama/shared/home";
import type { ActiveRow, MediaRowBucket } from "@nama/shared/media";
import { classifyBucket } from "../classify";
import { enrich, type MediaEnrichContext } from "../enrich";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";
import { paginate, type PaginateInput } from "../pipeline/paginate";
import { loadProgressMap } from "../progress";
import type { MediaSource } from "../source";
import type { Page, PipelineConfig, PipelineSort, RawPageToken, SourceContext } from "../types";

/**
 * Turns raw rows into enriched `CompactMediaItem`s. Default (watchlist): `batchLoad` +
 * `enrich`. Home injects custom enrichment (catalog projections, match-reason chip).
 * This is the only stage that varies by consumer; sort/filter/paginate stay shared (V.MC1).
 */
export type EnrichRowsFn<Row> = (
  rows: Row[],
) => Promise<{ items: CompactMediaItem[]; partial: boolean }>;

/**
 * Single media read path (design §C): fetchRawSet → enrich → [classify + filter] → sort → paginate (V.MC1).
 * Source produces raw rows; enrichment/sort/paginate handled here. Stages opt in via `source.stages`.
 * Soft failures surface as `partial: true`. Custom `enrichRows` overrides default (for home catalog projections).
 */
// Default path: a persisted-row source (`Row` = `ActiveRow`). No `enrichRows` —
// the pipeline runs its own `batchLoad` + `enrich` fan-out over the rows.
export function listRows<P>(
  source: MediaSource<P>,
  cfg: PipelineConfig<P>,
  ctx: SourceContext,
): Promise<Page>;
// Custom-row path: the source emits non-`ActiveRow` raw rows (home projects
// catalog feeds), so the consumer MUST supply an `enrichRows` that maps them to
// enriched items. Making it required here is what lets the implementation cast
// `raw.rows → ActiveRow[]` soundly: the no-`enrichRows` overload above is the
// only way to reach the default path, and it pins `Row` to `ActiveRow`.
export function listRows<P, Row>(
  source: MediaSource<P, Row>,
  cfg: PipelineConfig<P>,
  ctx: SourceContext,
  enrichRows: EnrichRowsFn<Row>,
): Promise<Page>;
export async function listRows<P, Row = ActiveRow>(
  source: MediaSource<P, Row>,
  cfg: PipelineConfig<P>,
  ctx: SourceContext,
  enrichRows?: EnrichRowsFn<Row>,
): Promise<Page> {
  // The source produces the raw row set plus its own pagination signals —
  // `partial` when a feed soft-failed, `nextRaw` for the keyset hop token.
  const raw = await source.fetchRawSet(ctx, cfg.params, cfg.cursor);

  const enriched = enrichRows
    ? await enrichRows(raw.rows)
    : // Only reachable via the no-`enrichRows` overload, which pins `Row` to
      // `ActiveRow` — so these rows ARE persisted `ActiveRow`s and the cast
      // bridges the impl signature's generic `Row` back to that.
      await defaultEnrich(raw.rows as unknown as ActiveRow[], ctx);

  // classify + filter, then sort, then paginate. paginate runs last over the
  // already filtered+sorted set; keyset mints the next cursor from the source's
  // hop token, offset slices the sorted set — the source minted neither (V.MC1).
  const filtered = applyBucketFilter(enriched.items, source, cfg);
  const sorted = sortItems(filtered, cfg.sort ?? source.stages.sort);
  const page = paginate(toPaginateInput(sorted, source, cfg, raw.nextRaw, ctx));

  return {
    items: page.items,
    cursor: page.cursor,
    partial: raw.partial || enriched.partial,
  };
}

/**
 * Default enrichment for persisted `ActiveRow`s: one status + metadata +
 * progress fan-out (design §C/§F) which `enrich` consumes via `prefetchedBatch`
 * so the read pays for the fan-out exactly once.
 */
async function defaultEnrich(
  rows: ActiveRow[],
  ctx: SourceContext,
): Promise<{ items: CompactMediaItem[]; partial: boolean }> {
  const batch = await batchLoad(rows, toBatchContext(ctx));
  const enriched = await enrich(rows, toEnrichContext(ctx), {
    prefetchedBatch: {
      statuses: batch.statuses,
      metadata: batch.metadata,
      progress: batch.progress,
    },
  });
  return { items: enriched.items, partial: batch.partial || enriched.partial };
}

/**
 * Classify + filter stage. Bucket classification runs here over the FULL enriched set,
 * then paginate slices in one pass (#501 sparse-bucket fix). Mood is pre-filtered by the
 * source's `fetchRawSet`; pipeline does not re-derive (V.MC1: `filter: "preapplied"` passes through).
 */
function applyBucketFilter<P, Row>(
  items: CompactMediaItem[],
  source: MediaSource<P, Row>,
  cfg: PipelineConfig<P>,
): CompactMediaItem[] {
  const target = bucketTarget(source, cfg);
  if (!target) return items;
  return items.filter((item) => classifyBucket(item) === target);
}

/** The bucket to filter on, or `undefined` when this read does not bucket-filter. */
function bucketTarget<P, Row>(
  source: MediaSource<P, Row>,
  cfg: PipelineConfig<P>,
): MediaRowBucket | undefined {
  const filterKind = cfg.filter ?? source.stages.filter;
  // Bucket filtering requires the classify stage (it reads each item's
  // classified bucket). A source that declares `filter: "bucket"` without
  // `classify: true` falls through UNFILTERED here — by design it must then
  // pre-filter source-side, like the `"preapplied"` mood path. Intentional
  // interlock, not a silent miss.
  if (filterKind !== "bucket" || !source.stages.classify) return undefined;
  return cfg.bucket;
}

/**
 * Order by `addedAt`. `"none"` is identity: source already returned final order
 * (metadata-presorted or pre-ranked), so leave untouched. Otherwise missing `addedAt`
 * items compare equal; stable sort preserves source order, so feed ranking survives default.
 */
function sortItems(items: CompactMediaItem[], sort: PipelineSort): CompactMediaItem[] {
  if (sort === "none") return items;
  const direction = sort === "recentAsc" ? 1 : -1;
  return items.slice().sort((a, b) => direction * ((a.addedAt ?? 0) - (b.addedAt ?? 0)));
}

function toPaginateInput<P, Row>(
  items: CompactMediaItem[],
  source: MediaSource<P, Row>,
  cfg: PipelineConfig<P>,
  nextRaw: RawPageToken | undefined,
  ctx: SourceContext,
): PaginateInput {
  return {
    items,
    cursorMode: source.stages.cursorMode,
    cursor: cfg.cursor,
    ...(nextRaw !== undefined ? { nextRaw } : {}),
    limit: cfg.limit,
    log: ctx.logger,
  };
}

/** Bridge the unified `SourceContext` onto the structural `batchLoad` surface. */
function toBatchContext(ctx: SourceContext): BatchLoadContext {
  return {
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    log: ctx.logger,
    ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
  };
}

/**
 * Bridge the unified `SourceContext` onto the `enrich` context: supply the
 * shared `loadProgressMap`, map `logger` → `log`, and thread through the
 * consumer-injected artwork/canonical-row callbacks when present.
 */
function toEnrichContext(ctx: SourceContext): MediaEnrichContext {
  return {
    userId: ctx.userId,
    mediaService: ctx.mediaService,
    catalog: ctx.catalog,
    loadProgressMap,
    log: ctx.logger,
    ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
    ...(ctx.getArtwork ? { getArtwork: ctx.getArtwork } : {}),
    ...(ctx.toCanonicalRow ? { toCanonicalRow: ctx.toCanonicalRow } : {}),
  };
}
