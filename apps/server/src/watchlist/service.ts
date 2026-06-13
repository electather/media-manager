import {
  type MoodId,
  type WatchlistBucket,
  type WatchlistKey,
  type WatchlistMoodSummary,
  type WatchlistResponse,
  type WatchlistSectionResponse,
  type WatchlistSort,
  type WatchlistSource,
} from "@nama/shared/watchlist";
import {
  addItem as mediaAddItem,
  removeItem as mediaRemoveItem,
  seedFromPlugins as mediaSeedFromPlugins,
  syncFromPlugins as mediaSyncFromPlugins,
  listRows,
  decode,
  type AddItemResult,
  type Cursor,
  type MediaSource,
  type PipelineConfig,
  type SeedResult,
} from "../media";
import {
  asWatchlistContext,
  clampLimit,
  type MaybeRowContext,
  type ResolvedWatchlistContext,
} from "./internal/context";
import { getSummary as getMoodSummaryImpl } from "./moods/cluster";
import { getSection as getTonightSectionImpl } from "./tonight/section";
import { itemsSource, itemsCfg, toItemsParams } from "./sources/items";
import { moodItemsSource, moodItemsCfg, type MoodParams } from "./sources/mood-items";
import { recentlySource, recentlyCfg } from "./sources/recently";
import { toSourceContext } from "./sources/context";

// Per-request context resolution + the non-section list reads (basic keyset
// list, available-on-server) live in `internal/`; the public surface is
// re-exported here so the barrel and consumers keep their import path.
export type { WatchlistContext } from "./internal/context";
export type { AddItemResult, SeedResult };
export { getItems, listAvailable, hasAny, type GetItemsOptions } from "./internal/reads";
export { watchlistMediaSources } from "./internal/media-sources";

/**
 * Idempotent add. The `watchlist_items` write + event now live in media
 * (design §M.2); this thin shell resolves the per-request context into the
 * enrich-ready shape and delegates.
 */
export async function addItem(
  key: WatchlistKey,
  source: WatchlistSource,
  ctx: MaybeRowContext,
): Promise<AddItemResult> {
  return mediaAddItem(key, source, asWatchlistContext(ctx));
}

/** Idempotent remove. Delegates to the media-owned `watchlist_items` write. */
export async function removeItem(
  key: WatchlistKey,
  ctx: MaybeRowContext,
): Promise<{ removed: boolean }> {
  return mediaRemoveItem(key, asWatchlistContext(ctx));
}

/**
 * Triggers a plugin seed. The `watchlist_items` bulk-insert now lives in media
 * (design §M.2); this thin shell resolves the per-request context and delegates.
 */
export async function seedFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  return mediaSeedFromPlugins(asWatchlistContext(ctx));
}

/** Periodic plugin merge. Delegates to the media-owned `watchlist_items` write. */
export async function syncFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  return mediaSyncFromPlugins(asWatchlistContext(ctx));
}

// ─────────────────────────────────────────────────────────────────────────
// Section endpoints — see docs/2026-05-23-watchlist-sections-design.md
// ─────────────────────────────────────────────────────────────────────────

export interface ListItemsOptions {
  cursor?: string;
  limit?: number;
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Run a watchlist section read through a `MediaSource`: decode the incoming
 * cursor against the source's declared mode (a bad/foreign/mode-mismatched
 * cursor → `null` → first page, V.CU1), list via the shared media pipeline, and
 * bridge the result onto the `WatchlistResponse` wire shape. The pipeline yields
 * public `CompactMediaItem`s — the unified item shape the response now carries
 * (active rows fill `addedAt`/`addedSource`; discovery rows leave them null).
 */
async function readSection<P>(
  c: ResolvedWatchlistContext,
  source: MediaSource<P>,
  toCfg: (cursor: Cursor | null) => PipelineConfig<P>,
  rawCursor: string | undefined,
): Promise<WatchlistResponse> {
  const cursor = rawCursor ? decode(rawCursor, source.stages.cursorMode) : null;
  const page = await listRows(source, toCfg(cursor), toSourceContext(c));
  return { items: page.items, cursor: page.cursor, partial: page.partial };
}

/**
 * Paginated list of watchlist items with sort + bucket + mood filters. Thin
 * envelope over the media read pipeline (design §S.1 / consolidation §H): the
 * `items` `MediaSource` supplies the raw rows + a `stages` declaration and
 * `media.listRows` owns enrich / classify / filter / sort / paginate / cursor.
 * `recent` + no filter rides the keyset window; every other read (a non-recent
 * metadata sort, or a bucket/mood filter) rides offset mode. When `bucket` is
 * omitted, every active row surfaces (V.WL2).
 */
export async function listItems(
  ctx: MaybeRowContext,
  opts: ListItemsOptions = {},
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  const params = toItemsParams({ ...opts, limit: clampLimit(opts.limit) });
  return readSection(c, itemsSource(params), (cursor) => itemsCfg(params, cursor), opts.cursor);
}

/**
 * Tonight section delegator. Implementation lives in `tonight/section.ts`
 * so cache state can co-locate with `invalidate(userId)` for the mutation
 * listener.
 */
export async function getTonightSection(ctx: MaybeRowContext): Promise<WatchlistSectionResponse> {
  return getTonightSectionImpl(asWatchlistContext(ctx));
}

/**
 * Last-added items, capped by `limit`. No cursor. Thin envelope over the media
 * read pipeline (design §S.4 / consolidation §H): the `recently` `MediaSource`
 * supplies the last `limit` raw rows (`addedAt` DESC) and `media.listRows` owns
 * enrich / sort. The pipeline yields public `CompactMediaItem`s — the unified
 * item shape the response now carries. The page cursor is discarded — the
 * section is a bounded preview, not paginated.
 */
export async function getRecentlyAdded(
  ctx: MaybeRowContext,
  limit: number,
): Promise<WatchlistSectionResponse> {
  const c = asWatchlistContext(ctx);
  const page = await listRows(recentlySource, recentlyCfg({ limit }), toSourceContext(c));
  return { items: page.items, partial: page.partial };
}

/** Mood-cluster summary delegator. */
export async function getMoodSummary(ctx: MaybeRowContext): Promise<WatchlistMoodSummary> {
  const c = asWatchlistContext(ctx);
  return getMoodSummaryImpl(c);
}

export interface ListMoodItemsOptions {
  cursor?: string;
  limit?: number;
}

/**
 * Paginated rows for a specific mood. Thin envelope over the media read
 * pipeline (design §S.3 / consolidation §H): the `mood-items` `MediaSource`
 * scans keyset windows, applies the mood predicate, and accumulates a full page
 * across windows (it owns the overshoot + empty-streak budget so a sparse mood
 * still fills a page); `media.listRows` owns enrich / sort / paginate / cursor.
 * A bad/foreign/mode-mismatched cursor decodes to `null` → first page (V.CU1).
 */
export async function listMoodItems(
  ctx: MaybeRowContext,
  moodId: MoodId,
  opts: ListMoodItemsOptions = {},
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  const params: MoodParams = { moodId, limit: clampLimit(opts.limit) };
  return readSection(c, moodItemsSource, (cursor) => moodItemsCfg(params, cursor), opts.cursor);
}
