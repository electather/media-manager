import type { ContinueWatchingEntry, LibraryItem } from "@ent-mcp/plugin-sdk";
import type { CanonicalMetadata, TopContributor } from "../catalog/types";
import type { InternalCompactMediaItem } from "./types";

/**
 * Adapters from heterogenous source shapes (catalog metadata, continueWatching
 * entries, watchlist items, calendar items) to the single `CompactMediaItem`
 * wire shape the home rows ship. Kept colocated with the rows so each pipeline
 * has a tight, readable mapping pass; expand when a row needs row-specific
 * fields.
 */

function compositeId(tmdbId: string, mediaType: "movie" | "tv"): string {
  return `${mediaType}:${tmdbId}`;
}

/** Maps `canonical_metadata` → `CompactMediaItem`. */
export function fromCanonicalMetadata(
  meta: CanonicalMetadata,
  opts: { topContributors?: readonly TopContributor[] } = {},
): InternalCompactMediaItem {
  const item: InternalCompactMediaItem = {
    id: compositeId(meta.tmdbId, meta.mediaType),
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    title: meta.title,
  };
  if (meta.year != null) item.year = meta.year;
  if (meta.posterUrl) item.poster = meta.posterUrl;
  if (meta.backdropUrl) item.backdrop = meta.backdropUrl;
  if (meta.clearLogoUrl) item.clearLogo = meta.clearLogoUrl;
  if (meta.overview) item.overview = meta.overview;
  if (meta.genres && meta.genres.length > 0) item.genres = meta.genres.slice(0, 3);
  if (opts.topContributors && opts.topContributors.length > 0) {
    item.__topContributors = [...opts.topContributors];
  }
  if (meta.runtimeMinutes != null) {
    item.facets = { ...item.facets, runtimeMin: meta.runtimeMinutes };
  }
  if (meta.year != null) {
    item.facets = { ...item.facets, releaseDate: String(meta.year) };
  }
  return item;
}

/**
 * Pulls a tmdb id from a `LibraryItem`. Plugins surface the cross-service ids
 * differently — Plex stores them in a side table referenced by guid, Jellyfin
 * uses ProviderIds.tmdb, etc. We accept any reasonable shape via best-effort
 * field inspection so the home rows don't have to know the per-server quirks.
 */
// fallow-ignore-next-line complexity
function pickTmdbIdFromLibraryItem(item: LibraryItem): string | null {
  const v = item as unknown as Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  const tmdb = v.tmdbId;
  if (typeof tmdb === "string") return tmdb;
  return null;
}

/**
 * Converts a `continueWatching@v1` entry into a `CompactMediaItem`. When the
 * caller sets `useNextUp: true` we project the `nextUp` payload (typically an
 * episode) onto the card and stamp `seriesContext.nextUpFromServer = true`.
 */
// fallow-ignore-next-line complexity
export function fromContinueWatchingEntry(
  entry: ContinueWatchingEntry,
  opts: { useNextUp?: boolean } = {},
): InternalCompactMediaItem | null {
  const source = opts.useNextUp ? (entry.nextUp ?? entry.item) : entry.item;
  const tmdbId = pickTmdbIdFromLibraryItem(source);
  if (!tmdbId) return null;
  const mediaType: "movie" | "tv" = source.type === "movie" ? "movie" : "tv";
  const out: InternalCompactMediaItem = {
    id: compositeId(tmdbId, mediaType),
    tmdbId,
    mediaType,
    title: source.title,
  };
  if (entry.progressMs != null && source.durationSec != null && source.durationSec > 0) {
    out.progress = {
      watched: Math.round(entry.progressMs / 1000),
      total: source.durationSec,
    };
  }
  if (mediaType === "tv" && source.season != null && source.episode != null) {
    out.seriesContext = {
      season: source.season,
      episode: source.episode,
      episodeTitle: source.title,
      nextUpFromServer: opts.useNextUp === true && entry.nextUp != null,
    };
  }
  return out;
}
