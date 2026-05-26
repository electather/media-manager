import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaRowBucket, RowSort } from "@ent-mcp/shared/media";
import { classifyBucket } from "../classify";
import { enrich, type MediaEnrichContext } from "../enrich";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";
import { paginate, type PaginateInput } from "../pipeline/paginate";
import { loadProgressMap } from "../progress";
import type { MediaSource } from "../source";
import type { Page, PipelineConfig, RawPageToken, SourceContext } from "../types";

/**
 * The single media read path (design §C). A consumer hands a `MediaSource`
 * (which only knows how to produce a raw row set) plus an already-decoded
 * `PipelineConfig`, and `listRows` runs the shared stages:
 *
 *   fetchRawSet → batchLoad → enrich → [classify + filter] → sort → paginate
 *
 * The source carries no enrich/sort/slice/cursor logic — all of that lives here
 * (invariant V.MC1). Stages opt in via `source.stages` (with `cfg` overrides).
 * Soft failures (a plugin feed degrading, a sub-load falling back) surface as
 * `partial: true` rather than throwing, so the consumer envelope decides
 * whether to ship the degraded page.
 */
export async function listRows<P>(
  source: MediaSource<P>,
  cfg: PipelineConfig<P>,
  ctx: SourceContext,
): Promise<Page> {
  // The source produces the raw row set plus its own pagination signals —
  // `partial` when a feed soft-failed, `nextRaw` for the keyset hop token.
  const raw = await source.fetchRawSet(ctx, cfg.params, cfg.cursor);

  // One status + metadata + progress fan-out (design §C/§F); `enrich` consumes
  // it via `prefetchedBatch`, so the read pays for the fan-out exactly once.
  const batch = await batchLoad(raw.rows, toBatchContext(ctx));
  const enriched = await enrich(raw.rows, toEnrichContext(ctx), {
    prefetchedBatch: {
      statuses: batch.statuses,
      metadata: batch.metadata,
      progress: batch.progress,
    },
  });

  // classify + filter, then sort, then paginate. paginate runs last over the
  // already filtered+sorted set; keyset mints the next cursor from the source's
  // hop token, offset slices the sorted set — the source minted neither (V.MC1).
  const filtered = applyBucketFilter(enriched.items, source, cfg);
  const sorted = sortItems(filtered, cfg.sort ?? source.stages.sort);
  const page = paginate(toPaginateInput(sorted, source, cfg, raw.nextRaw, ctx));

  return {
    items: page.items,
    cursor: page.cursor,
    partial: raw.partial || batch.partial || enriched.partial,
  };
}

/**
 * The classify + filter stage. Bucket classification is media-owned, so the
 * bucket predicate runs here over the FULL enriched set — paginate then slices
 * the whole filtered tail in one pass, preserving the #501 single-pass
 * sparse-bucket fix. Mood is a watchlist-product concept media must not import,
 * so a mood source filters inside its own `fetchRawSet`; the pipeline does not
 * re-derive it here (a `filter: "mood"` source falls straight through).
 */
function applyBucketFilter<P>(
  items: CompactMediaItem[],
  source: MediaSource<P>,
  cfg: PipelineConfig<P>,
): CompactMediaItem[] {
  const target = bucketTarget(source, cfg);
  if (!target) return items;
  return items.filter((item) => classifyBucket(item) === target);
}

/** The bucket to filter on, or `undefined` when this read does not bucket-filter. */
function bucketTarget<P>(
  source: MediaSource<P>,
  cfg: PipelineConfig<P>,
): MediaRowBucket | undefined {
  const filterKind = cfg.filter ?? source.stages.filter;
  if (filterKind !== "bucket" || !source.stages.classify) return undefined;
  return cfg.bucket;
}

/**
 * Order the enriched set by `addedAt`. Items without an `addedAt` (discovery
 * feeds) compare equal, so the stable sort preserves the order the source
 * returned them in — a feed's relevance ranking survives a `recentDesc`
 * default unchanged.
 */
function sortItems(items: CompactMediaItem[], sort: RowSort): CompactMediaItem[] {
  const direction = sort === "recentAsc" ? 1 : -1;
  return items.slice().sort((a, b) => direction * ((a.addedAt ?? 0) - (b.addedAt ?? 0)));
}

function toPaginateInput<P>(
  items: CompactMediaItem[],
  source: MediaSource<P>,
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
