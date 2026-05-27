import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { ActiveRow } from "@ent-mcp/shared/media";
import {
  keyToId,
  type MoodId,
  type WatchlistBucket,
  type WatchlistSort,
} from "@ent-mcp/shared/watchlist";
import {
  listActiveRowsKeyset,
  listAllActiveRows,
  type Cursor,
  type FilterKind,
  type MediaSource,
  type PipelineConfig,
  type PipelineSort,
  type RawPageToken,
  type SourceContext,
} from "../../media";
import { derive as deriveMoods } from "../moods/derive";
import { decodeKeyset, rawToken } from "./keyset";
import { loadRowMetadata } from "./metadata";

/**
 * Request params for the watchlist `items` source. `sort`/`bucket`/`mood` come
 * from the `/items` query; the source bakes them into its `stages` (which sort
 * + cursor mode + filter the pipeline runs) and reads `mood` inside
 * `fetchRawSet` (mood is a watchlist-product predicate media must not derive).
 */
export interface ItemsParams {
  limit: number;
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

type MetadataSort = Exclude<WatchlistSort, "recent">;

const STATUS_PRIORITY: Record<string, number> = {
  available: 0,
  processing: 1,
  requested: 2,
  unavailable: 3,
  unknown: 4,
};

/**
 * `recent` with no filter is the only read that can ride the efficient keyset
 * window. Every other read (a non-recent metadata sort, or a `bucket`/`mood`
 * filter) goes through offset mode: the source loads the full active set and
 * the pipeline classifies/filters/sorts/slices over it in one pass, preserving
 * the #501 single-pass sparse-bucket fix (media `paginate`, design §S.1).
 */
function isKeysetRead(params: ItemsParams): boolean {
  return params.sort === "recent" && !params.bucket && !params.mood;
}

function filterKind(params: ItemsParams): FilterKind {
  return params.bucket ? "bucket" : params.mood ? "mood" : undefined;
}

/**
 * `recent` reads (keyset or offset) sort by `addedAt` in the pipeline. A
 * non-recent metadata sort is done by the source (`RowSort` cannot express it),
 * so it declares `"none"` and the pipeline preserves the source's order.
 */
function pipelineSort(params: ItemsParams, keyset: boolean): PipelineSort {
  return keyset || params.sort === "recent" ? "recentDesc" : "none";
}

/**
 * The watchlist `items` `MediaSource` (design §S.1 / consolidation §B/§H). It
 * supplies ONLY the raw row set + a `stages` declaration; the media pipeline
 * (`listRows`) owns enrich / classify / filter / sort / paginate / cursor
 * (invariant V.MC1). It is a per-request factory because the cursor mode and
 * pipeline sort depend on the requested `sort`/`bucket`/`mood`:
 *
 * - `recent` + no filter → `keyset` (addedAt DESC, id DESC); efficient indexed
 *   window, strict-stable across mutations, #500 empty-streak preserved.
 * - `recent` + bucket/mood → `offset`; full-load so the bucket/mood predicate
 *   runs over the whole set (#501), pipeline re-sorts by `addedAt` (`recentDesc`).
 * - `alpha`/`runtime`/`status` → `offset`; the source pre-sorts the raw rows by
 *   catalog metadata (which `RowSort` cannot express) and declares `sort:"none"`
 *   so the pipeline preserves that order, then slices `(offset, limit)`.
 */
export function itemsSource(params: ItemsParams): MediaSource<ItemsParams> {
  const keyset = isKeysetRead(params);
  return {
    sourceId: "watchlist.items",
    fetchRawSet: keyset ? fetchKeyset : fetchOffset,
    stages: {
      classify: true,
      filter: filterKind(params),
      sort: pipelineSort(params, keyset),
      cursorMode: keyset ? "keyset" : "offset",
    },
  };
}

/** Build the `/items` source params from the public list options. */
export function toItemsParams(opts: {
  limit: number;
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}): ItemsParams {
  return {
    limit: opts.limit,
    sort: opts.sort ?? "recent",
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    ...(opts.mood ? { mood: opts.mood } : {}),
  };
}

/** Build the pipeline config for an `/items` read (filter + the decoded cursor). */
export function itemsCfg(params: ItemsParams, cursor: Cursor | null): PipelineConfig<ItemsParams> {
  return {
    params,
    cursor,
    limit: params.limit,
    ...(params.bucket
      ? { filter: "bucket" as const, bucket: params.bucket }
      : params.mood
        ? { filter: "mood" as const }
        : {}),
  };
}

/**
 * Keyset window for `recent` + no filter. Fetches exactly `limit` rows (no
 * over-fetch — there is no downstream filter to prune them), and threads back
 * the last row as `nextRaw` when the window was full. A short window means the
 * scan is exhausted, so `nextRaw` is omitted and the pipeline emits `cursor:null`
 * (#500). Matches the pre-refactor `getItems`/`listItems` recent path exactly.
 */
// fallow-ignore-next-line complexity
async function fetchKeyset(
  ctx: SourceContext,
  params: ItemsParams,
  cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  const pageCursor = decodeKeyset(cursor);
  const rows = await listActiveRowsKeyset(ctx.userId, {
    limit: params.limit,
    ...(pageCursor ? { cursor: pageCursor } : {}),
  });
  const last = rows[rows.length - 1];
  const exhausted = rows.length < params.limit;
  const nextRaw = exhausted || !last ? undefined : rawToken(last);
  return { rows, partial: false, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

/**
 * Full active set for an offset read (non-recent metadata sort, or any
 * bucket/mood filter). The mood predicate and the alpha/runtime/status sort
 * both need catalog metadata, so the source batches it here; the pipeline's own
 * `batchLoad` re-reads it from the warmed catalog cache. `recent` (+ bucket)
 * skips the source sort — the pipeline sorts `recentDesc`. Offset sources mint
 * no `nextRaw`; the pipeline slices by the incoming offset cursor index.
 */
// fallow-ignore-next-line complexity
async function fetchOffset(
  ctx: SourceContext,
  params: ItemsParams,
  _cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  const all = await listAllActiveRows(ctx.userId);
  if (all.length === 0) return { rows: [], partial: false };

  const meta = await loadMetaIfNeeded(ctx, all, params);
  const filtered = params.mood ? filterRowsByMood(all, meta.map, params.mood) : all;
  if (params.sort === "recent") return { rows: filtered, partial: meta.partial };

  const sorted = await sortRowsByMetadata(ctx, filtered, meta.map, params.sort);
  return { rows: sorted.rows, partial: meta.partial || sorted.partial };
}

function needsMeta(params: ItemsParams): boolean {
  return !!params.mood || params.sort === "alpha" || params.sort === "runtime";
}

async function loadMetaIfNeeded(
  ctx: SourceContext,
  rows: ActiveRow[],
  params: ItemsParams,
): Promise<{ map: Record<string, CanonicalMetadata>; partial: boolean }> {
  if (!needsMeta(params)) return { map: {}, partial: false };
  return loadRowMetadata(ctx, rows, "items");
}

function filterRowsByMood(
  rows: ActiveRow[],
  metaMap: Record<string, CanonicalMetadata>,
  mood: MoodId,
): ActiveRow[] {
  return rows.filter((r) =>
    deriveMoods(metaMap[keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })]).includes(mood),
  );
}

async function sortRowsByMetadata(
  ctx: SourceContext,
  rows: ActiveRow[],
  metaMap: Record<string, CanonicalMetadata>,
  sort: MetadataSort,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  let partial = false;
  const statusMap =
    sort === "status"
      ? await ctx.mediaService
          .getStatusBatch(rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })))
          .catch((err) => {
            ctx.logger.warn("[watchlist:items] status batch failed", err);
            partial = true;
            return {} as Record<string, string>;
          })
      : {};
  const ordered = rows.slice().sort((a, b) => compareForSort(a, b, metaMap, statusMap, sort));
  return { rows: ordered, partial };
}

function compareForSort(
  a: ActiveRow,
  b: ActiveRow,
  metaMap: Record<string, CanonicalMetadata>,
  statusMap: Record<string, string>,
  sort: MetadataSort,
): number {
  const aId = keyToId({ tmdbId: a.tmdbId, mediaType: a.mediaType });
  const bId = keyToId({ tmdbId: b.tmdbId, mediaType: b.mediaType });
  if (sort === "alpha") return compareAlpha(metaMap[aId], metaMap[bId]);
  if (sort === "runtime") return compareRuntime(metaMap[aId], metaMap[bId]);
  return statusRank(aId, statusMap) - statusRank(bId, statusMap);
}

// fallow-ignore-next-line complexity
function compareAlpha(aMeta?: CanonicalMetadata, bMeta?: CanonicalMetadata): number {
  const at = (aMeta?.title ?? "").toLocaleLowerCase().normalize("NFD");
  const bt = (bMeta?.title ?? "").toLocaleLowerCase().normalize("NFD");
  return at.localeCompare(bt);
}

// fallow-ignore-next-line complexity
function compareRuntime(aMeta?: CanonicalMetadata, bMeta?: CanonicalMetadata): number {
  const ar = aMeta?.runtimeMinutes ?? Number.POSITIVE_INFINITY;
  const br = bMeta?.runtimeMinutes ?? Number.POSITIVE_INFINITY;
  return ar - br;
}

function statusRank(id: string, statusMap: Record<string, string>): number {
  return STATUS_PRIORITY[statusMap[id] ?? "unknown"] ?? 9;
}
