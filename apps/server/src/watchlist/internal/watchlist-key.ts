import { extractTmdbId } from "@ent-mcp/shared/media";
import type { WatchlistKey } from "@ent-mcp/shared/watchlist";

/**
 * Probes a `watchlist@v1` entry for `{ tmdbId, mediaType }`. Plugins emit
 * either a flat object or `{ item: {...} }` envelope; TMDB id is found under
 * `ids.tmdb`, `ids.tmdb_id`, or a top-level `tmdbId`.
 */
// fallow-ignore-next-line complexity
export function toWatchlistKey(value: unknown): WatchlistKey | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const itemRaw = (outer.item ?? outer) as Record<string, unknown>;
  const tmdbId = extractTmdbId(itemRaw);
  if (!tmdbId) return null;
  const rawType = itemRaw.type;
  let mediaType: "movie" | "tv";
  if (rawType === "movie") {
    mediaType = "movie";
  } else if (rawType === "tv" || rawType === "show") {
    mediaType = "tv";
  } else {
    return null;
  }
  return { tmdbId, mediaType };
}
