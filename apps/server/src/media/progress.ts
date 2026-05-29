import type { MediaType } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import type { MediaProgressContext, MediaProgressService } from "./types";

/** Per-row resume position used by `classifyBucket` to mark `in-progress` rows. */
export interface ProgressEntry {
  watched: number;
  total: number;
}

export type ProgressMap = ReadonlyMap<string, ProgressEntry>;

/** Shared cutoff for treating a continue-watching entry as still active. */
export const FINISHING_THRESHOLD = 0.85;

/**
 * Canonical "finishing soon" test over a projected `{ watched, total }`
 * progress. A title is finishing once watched ≥ 85% of its total. Returns
 * `false` for a non-positive `total` so callers do not divide by zero. This is
 * the one definition the home match-reason and the watchlist projection share.
 */
export function isFinishing(progress: ProgressEntry): boolean {
  if (progress.total <= 0) return false;
  return progress.watched / progress.total >= FINISHING_THRESHOLD;
}

// Keyed by the per-request MediaService instance so the plugin fan-out happens at most once per request.
const cache = new WeakMap<MediaProgressService, Promise<{ map: ProgressMap; partial: boolean }>>();

type ProgressCtx = MediaProgressContext;

/**
 * Per-request memoized fetch of the continue-watching aggregate, projected
 * down to a `compositeId → { watched, total }` map. `enrich` and `getCounts`
 * both call this — the WeakMap key is the request-scoped `MediaService`
 * instance so the plugin fan-out happens at most once per request.
 *
 * On every plugin failing, returns `{ map: empty, partial: true }`; the
 * watchlist counts/list paths surface `partial` to the client without
 * blocking the response on a missing CW signal.
 */
export async function loadProgressMap(
  ctx: ProgressCtx,
): Promise<{ map: ProgressMap; partial: boolean }> {
  const existing = cache.get(ctx.mediaService);
  if (existing) return existing;
  const fresh = compute(ctx);
  cache.set(ctx.mediaService, fresh);
  return fresh;
}

// fallow-ignore-next-line complexity
async function compute(ctx: ProgressCtx): Promise<{ map: ProgressMap; partial: boolean }> {
  const opts = ctx.deadlineMs != null ? { deadlineMs: ctx.deadlineMs } : {};
  try {
    const res = await ctx.mediaService.getContinueWatchingFeed(opts);
    const map = new Map<string, ProgressEntry>();
    for (const entry of res.items) {
      const projected = projectProgressMapEntry(entry as ContinueWatchingProgressEntry);
      if (projected) map.set(projected.id, projected.entry);
    }
    return { map, partial: res.partial };
  } catch (err) {
    ctx.log.warn("[media:progress] getContinueWatchingFeed failed", err);
    return { map: new Map(), partial: true };
  }
}

export interface ContinueWatchingProgressEntry {
  progressMs?: number;
  item: {
    type?: string;
    durationSec?: number;
    ids?: Record<string, unknown>;
    tmdbId?: unknown;
  };
}

// fallow-ignore-next-line complexity
export function isActiveContinueWatchingEntry(entry: ContinueWatchingProgressEntry): boolean {
  const ms = entry.progressMs;
  if (ms == null || ms <= 0) return false;
  const total = entry.item.durationSec;
  if (total == null || total <= 0) return true;
  return ms / 1000 / total < FINISHING_THRESHOLD;
}

// Home rows can surface active entries without duration, but watchlist
// classification needs a measurable total to project progress.
function watchlistTotalOf(entry: ContinueWatchingProgressEntry): number | null {
  const total = entry.item.durationSec;
  return total != null && total > 0 ? total : null;
}

export function projectContinueWatchingProgress(
  entry: ContinueWatchingProgressEntry,
): ProgressEntry | null {
  if (!isActiveContinueWatchingEntry(entry)) return null;
  const total = watchlistTotalOf(entry);
  if (total == null) return null;
  // `isActiveContinueWatchingEntry` already verified `progressMs > 0`.
  const watched = Math.round((entry.progressMs as number) / 1000);
  // Re-check threshold against the rounded value so near-boundary entries match the prior
  // rounded-ratio behaviour (e.g. 101500ms/120s rounds to 102s → 0.85 → excluded).
  if (watched / total >= FINISHING_THRESHOLD) return null;
  return { watched, total };
}

export function projectProgressMapEntry(
  entry: ContinueWatchingProgressEntry,
): { id: string; entry: ProgressEntry } | null {
  const progress = projectContinueWatchingProgress(entry);
  if (!progress) return null;
  const tmdbId = extractTmdbId(entry.item);
  if (!tmdbId) return null;
  const mediaType: MediaType = entry.item.type === "movie" ? "movie" : "tv";
  return {
    id: keyToId({ tmdbId, mediaType }),
    entry: progress,
  };
}

/**
 * Canonical tmdb-id probe shared across home/watchlist/media. Plugins surface
 * the cross-service ids differently — under `ids.tmdb`, `ids.tmdb_id`, or a
 * top-level `tmdbId` — so this single best-effort order keeps every adapter
 * consistent. Accepts `unknown` so the divergent consumer payloads collapse
 * onto this one definition.
 */
// fallow-ignore-next-line complexity
export function extractTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  if (typeof v.tmdbId === "string") return v.tmdbId;
  return null;
}
