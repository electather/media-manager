import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, type RawMediaItem } from "../compact";

const ROW_ID = "continueWatching" as const satisfies RowKind;
const MAX_ITEMS = 100;

/**
 * In-progress items aggregated across every plugin implementing
 * `watchHistory@v1.getInProgress`. Within-row dedupe by composite id; the
 * most-recent `lastWatchedAt` wins on overlap so the row sorts consistently
 * even when two plugins track the same title.
 *
 * No PreferenceEngine re-rank: in-progress is a resume affordance, not a
 * discovery surface — recency is the only sort that makes sense.
 */
export const continueWatchingFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Continue Watching",
  requires: ["watchHistory@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const offset = readOffset(opts.cursor);
    const result = await ctx.mediaService.getInProgress({ limit: MAX_ITEMS });
    const merged = mergeAndDedupe(result.items as InProgressEntry[]);
    const slice = merged.slice(offset, offset + opts.limit);
    const items = slice.map(mapToCompact);
    const nextOffset = offset + slice.length;
    const cursor =
      nextOffset >= merged.length || nextOffset >= MAX_ITEMS
        ? null
        : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, o: nextOffset });
    return result.partial ? { items, cursor, partial: true } : { items, cursor };
  },

  async isEligible(_userId: string, loader): Promise<boolean> {
    return loader.hasPlugin("watchHistory@v1");
  },
};

interface InProgressEntry {
  item: RawMediaItem;
  watchedMs: number;
  durationMs: number;
  lastWatchedAt: string;
  episode?: { season: number; episode: number; name?: string };
  episodeProgress?: { watched: number; total: number };
}

function readOffset(cursor: string | null): number {
  if (!cursor) return 0;
  const decoded = decodeCursor(ROW_ID, cursor);
  return decoded.o;
}

/**
 * Aggregates entries from every contributing plugin and dedupes by
 * `(tmdbId, mediaType)` composite id, preferring the most recent
 * `lastWatchedAt`. Sorts the survivors most-recent-first, which matches the
 * design's "resume what you were just watching" intent.
 */
function mergeAndDedupe(entries: InProgressEntry[]): InProgressEntry[] {
  const byId = new Map<string, InProgressEntry>();
  for (const entry of entries) {
    if (!entry || !entry.item) continue;
    const id = compositeId(entry);
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || compareLastWatched(entry, existing) > 0) byId.set(id, entry);
  }
  return [...byId.values()].sort((a, b) => compareLastWatched(b, a));
}

function compositeId(entry: InProgressEntry): string | null {
  const item = entry.item;
  const tmdbId = item.ids?.tmdb_id ?? maybeIdFromComposite(item.id);
  if (!tmdbId) return null;
  return `${item.type}:${tmdbId}`;
}

function maybeIdFromComposite(id: string | undefined): string | null {
  if (!id || !id.includes(":")) return null;
  return id.split(":")[1] ?? null;
}

function compareLastWatched(a: InProgressEntry, b: InProgressEntry): number {
  const aTs = Date.parse(a.lastWatchedAt) || 0;
  const bTs = Date.parse(b.lastWatchedAt) || 0;
  return aTs - bTs;
}

/**
 * Builds the wire item. `progress` is intentionally omitted when the source
 * could not measure `durationMs` (zero / negative / missing) — the
 * server-client contract documented in the design treats the absence as
 * "in-progress, progress unmeasurable", which the dashboard renders with a
 * generic play affordance rather than a zero-width bar.
 */
function mapToCompact(entry: InProgressEntry): CompactMediaItem {
  const extras: Partial<CompactMediaItem> = {};
  if (entry.durationMs > 0 && entry.watchedMs >= 0) {
    extras.progress = { watched: entry.watchedMs, total: entry.durationMs };
  }
  if (entry.episodeProgress && entry.episodeProgress.total > 0) {
    extras.episodeProgress = entry.episodeProgress;
  }
  return toCompact(entry.item, extras);
}
