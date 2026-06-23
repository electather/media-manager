import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { ActiveRow } from "@nama/shared/media";
import {
  keyToId,
  type MoodId,
  type WatchlistBucket,
  type WatchlistSort,
} from "@nama/shared/watchlist";
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
 * Request params for the watchlist `items` source. `sort`/`bucket`/`mood` are
 * baked into `stages`; `mood` is read inside `fetchRawSet` (watchlist-product
 * predicate, not media-derived).
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
 * `recent` + no filter = keyset window (efficient indexed). All others =
 * offset (full load, single-pass filter/sort/slice). Preserves #501 sparse-bucket
 * fix (design §S.1).
 */
function isKeysetRead(params: ItemsParams): boolean {
  return params.sort === "recent" && !params.bucket && !params.mood;
}

function filterKind(params: ItemsParams): FilterKind {
  return params.bucket ? "bucket" : params.mood ? "preapplied" : undefined;
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
 * Design §S.1, invariant V.MC1. Routes cursor mode and sort: `recent`+no
 * filter→keyset (indexed, #500); others→offset (#501, pre-sorts by catalog metadata).
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
        ? { filter: "preapplied" as const }
        : {}),
  };
}

/**
 * Keyset window for `recent` + no filter. Fetches exactly `limit` rows (no
 * over-fetch), threads back last row as `nextRaw` if full. Short window =
 * exhausted, omit `nextRaw` → `cursor:null` (#500).
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
 * Batches catalog metadata for mood predicates and alpha/runtime/status sorts.
 * Pipeline's `batchLoad` re-reads from cache; no `nextRaw` (pipeline slices by offset index).
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
  const at = aMeta?.title ?? "";
  const bt = bMeta?.title ?? "";
  // Pinned locale ("en"), "accent" sensitivity, then full collation to break
  // case ties deterministically. Avoids host-default localeCompare/toLocaleLowerCase
  // (locale-dependent, e.g. Turkish dotless-i) and JS sort stability (input-order-dependent).
  return at.localeCompare(bt, "en", { sensitivity: "accent" }) || at.localeCompare(bt, "en");
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
