import type { ConsolaInstance } from "consola";
import type { MediaType } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import type { MediaService } from "./service";

/** Per-row resume position used by `classifyBucket` to mark `in-progress` rows. */
export interface ProgressEntry {
  watched: number;
  total: number;
}

export type ProgressMap = ReadonlyMap<string, ProgressEntry>;

/** Matches the home `continue-watching-active` row's "still active" threshold. */
const FINISHING_THRESHOLD = 0.85;

const cache = new WeakMap<MediaService, Promise<{ map: ProgressMap; partial: boolean }>>();

interface ProgressCtx {
  mediaService: MediaService;
  log: ConsolaInstance;
  deadlineMs?: number;
}

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
      const projected = projectEntry(entry);
      if (projected) map.set(projected.id, projected.entry);
    }
    return { map, partial: res.partial };
  } catch (err) {
    ctx.log.warn("[media:progress] getContinueWatchingFeed failed", err);
    return { map: new Map(), partial: true };
  }
}

interface RawCwEntry {
  progressMs?: number;
  item: {
    type?: string;
    durationSec?: number;
    ids?: Record<string, unknown>;
    tmdbId?: unknown;
  };
}

// fallow-ignore-next-line complexity
function projectEntry(entry: RawCwEntry): { id: string; entry: ProgressEntry } | null {
  const ms = entry.progressMs;
  if (ms == null || ms <= 0) return null;
  const total = entry.item.durationSec;
  if (total == null || total <= 0) return null;
  const watchedSec = Math.round(ms / 1000);
  if (watchedSec / total >= FINISHING_THRESHOLD) return null;
  const tmdbId = extractTmdbId(entry.item);
  if (!tmdbId) return null;
  const mediaType: MediaType = entry.item.type === "movie" ? "movie" : "tv";
  return {
    id: keyToId({ tmdbId, mediaType }),
    entry: { watched: watchedSec, total },
  };
}

// fallow-ignore-next-line complexity
function extractTmdbId(value: { ids?: Record<string, unknown>; tmdbId?: unknown }): string | null {
  const ids = value.ids;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  if (typeof value.tmdbId === "string") return value.tmdbId;
  return null;
}
