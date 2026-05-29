import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { ActiveRow, MediaRowBucket } from "@ent-mcp/shared/media";
import { classifyBucket } from "../classify";
import { enrich, type MediaEnrichContext } from "../enrich";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";
import { paginate, type PaginateInput } from "../pipeline/paginate";
import { loadProgressMap } from "../progress";
import type { MediaSource } from "../source";
import type { Page, PipelineConfig, PipelineSort, RawPageToken, SourceContext } from "../types";

/**
 * Turns a source's raw row set into enriched, public `CompactMediaItem`s. The
 * default (watchlist) strategy is `batchLoad` + the shared `enrich`; consumers
 * whose rows are not persisted `ActiveRow`s and whose enrichment differs (home,
 * which projects catalog feeds and adds a row-aware match-reason chip) inject
 * their own. This is the one pipeline stage that legitimately varies by
 * consumer; sort/filter/paginate stay shared (invariant V.MC1).
 */
export type EnrichRowsFn<Row> = (
  rows: Row[],
) => Promise<{ items: CompactMediaItem[]; partial: boolean }>;

/**
 * The single media read path (design §C). A consumer hands a `MediaSource`
 * (which only knows how to produce a raw row set) plus an already-decoded
 * `PipelineConfig`, and `listRows` runs the shared stages:
 *
 *   fetchRawSet → enrich → [classify + filter] → sort → paginate
 *
 * The source carries no enrich/sort/slice/cursor logic — all of that lives here
 * (invariant V.MC1). Stages opt in via `source.stages` (with `cfg` overrides).
 * Soft failures (a plugin feed degrading, a sub-load falling back) surface as
 * `partial: true` rather than throwing, so the consumer envelope decides
 * whether to ship the degraded page.
 *
 * `enrichRows` overrides the default `batchLoad` + `enrich` projection. When
 * omitted, `Row` is the persisted `ActiveRow` (watchlist) and the default
 * fan-out runs; home supplies it (its feed rows are not `ActiveRow`s and its
 * enrichment owns the match-reason chip), in which case the default fan-out is
 * skipped entirely.
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
 * The classify + filter stage. Bucket classification is media-owned, so the
 * bucket predicate runs here over the FULL enriched set — paginate then slices
 * the whole filtered tail in one pass, preserving the #501 single-pass
 * sparse-bucket fix. Mood is a watchlist-product concept media must not import,
 * so a mood source filters inside its own `fetchRawSet`; the pipeline does not
 * re-derive it here (a `filter: "preapplied"` source falls straight through).
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
  if (filterKind !== "bucket" || !source.stages.classify) return undefined;
  return cfg.bucket;
}

/**
 * Order the enriched set by `addedAt`. `"none"` is the identity sort — the
 * source already returned rows in final order (a metadata-presorted offset
 * source or a pre-ranked feed), so the pipeline must leave them untouched.
 * Otherwise items without an `addedAt` (discovery feeds) compare equal, so the
 * stable sort preserves the order the source returned them in — a feed's
 * relevance ranking survives a `recentDesc` default unchanged.
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
