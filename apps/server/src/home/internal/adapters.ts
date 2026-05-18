import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";
import type { CanonicalMetadata, TopContributor } from "@ent-mcp/shared/catalog";
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

/**
 * Maps `canonical_metadata` → `CompactMediaItem`. Each optional field is
 * a separate branch by design: the wire spec omits absent fields rather
 * than emitting `null`, so the cyclomatic count tracks the number of
 * optional fields the catalog row carries.
 */
export function fromCanonicalMetadata(
  meta: CanonicalMetadata,
  opts: { topContributors?: readonly TopContributor[] } = {},
): InternalCompactMediaItem {
  const item: InternalCompactMediaItem = {
    id: compositeId(meta.tmdbId, meta.mediaType),
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    title: meta.title,
    // Catalog write timestamp drives the `recently_added` chip; year is too
    // coarse for the 7-day window the match-reason resolver wants.
    __addedAtMs: meta.createdAt,
  };
  applyOptionalFields(item, meta);
  if (opts.topContributors && opts.topContributors.length > 0) {
    item.__topContributors = [...opts.topContributors];
  }
  const facets = buildFacets(meta);
  if (facets) item.facets = facets;
  return item;
}

// fallow-ignore-next-line complexity
function applyOptionalFields(item: InternalCompactMediaItem, meta: CanonicalMetadata): void {
  if (meta.year != null) item.year = meta.year;
  if (meta.posterUrl) item.poster = meta.posterUrl;
  if (meta.backdropUrl) item.backdrop = meta.backdropUrl;
  if (meta.clearLogoUrl) item.clearLogo = meta.clearLogoUrl;
  if (meta.overview) item.overview = meta.overview;
  if (meta.genres && meta.genres.length > 0) item.genres = meta.genres.slice(0, 3);
}

function buildFacets(meta: CanonicalMetadata): InternalCompactMediaItem["facets"] {
  const out: NonNullable<InternalCompactMediaItem["facets"]> = {};
  if (meta.runtimeMinutes != null) out.runtimeMin = meta.runtimeMinutes;
  if (meta.year != null) out.releaseDate = String(meta.year);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pulls a tmdb id from a heterogenous plugin payload. Plugins surface the
 * cross-service ids differently — Plex stores them in a side table referenced
 * by guid, Jellyfin uses `ProviderIds.tmdb`, the recommendations capability
 * sometimes nests them under `ids.tmdb_id`. Single best-effort probe order
 * shared across every adapter keeps the row code consistent.
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
  const tmdbId = extractTmdbId(source);
  if (!tmdbId) return null;
  const mediaType: "movie" | "tv" = source.type === "movie" ? "movie" : "tv";
  const out: InternalCompactMediaItem = {
    id: compositeId(tmdbId, mediaType),
    tmdbId,
    mediaType,
    title: source.title,
  };
  // `progressMs` belongs to `entry.item`, not `entry.nextUp` — the next-up
  // episode hasn't been started, so omit `progress` when projecting onto it.
  if (
    !opts.useNextUp &&
    entry.progressMs != null &&
    source.durationSec != null &&
    source.durationSec > 0
  ) {
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
