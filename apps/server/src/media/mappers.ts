import { isNil } from "es-toolkit/predicate";
import {
  COMPACT_FIELDS,
  toCompact,
  type CompactMediaItem,
  type DetailEpisode,
  type DetailSeason,
  type EpisodeStatus,
  type MediaDetail,
  type MediaType,
  type SeasonStatus,
  type SeriesStatus,
} from "@ent-mcp/shared/media";
import { pick } from "es-toolkit/object";

/**
 * Plugin-shaped raw item lifted off the metadata capability output.
 * Fields are best-effort because plugins disagree on naming. The mapper
 * picks the first non-empty value within each conceptual slot.
 */
interface RawArtwork {
  poster?: string | null;
  posterUrl?: string | null;
  backdrop?: string | null;
  backdropUrl?: string | null;
  clearLogo?: string | null;
  clearLogoUrl?: string | null;
}

interface RawSeasonEpisode {
  id?: string;
  episode?: number;
  number?: number;
  title?: string;
  name?: string;
  airDate?: string;
  aired?: string;
  runtime?: number;
  status?: string;
}

interface RawSeason {
  id?: string;
  number?: number;
  season?: number;
  title?: string;
  name?: string;
  episodeCount?: number;
  status?: string;
  episodes?: RawSeasonEpisode[];
  counts?: {
    available?: number;
    requested?: number;
    upcoming?: number;
  };
}

interface RawDetailItem extends RawArtwork {
  id?: string;
  title?: string;
  year?: number | null;
  type?: MediaType;
  genres?: string[];
  rating?: number | null;
  overview?: string;
  ids?: { tmdb_id?: string; imdb_id?: string };
  userRating?: number | null;
  runtime?: number | string | null;
  ageRating?: string;
  votes?: number;
  audienceScore?: number;
  criticScore?: number;
  tags?: string[];
  director?: string | null;
  cast?: string[];
  trailerUrl?: string;
  seriesStatus?: SeriesStatus;
  nextAirDate?: string;
  seasons?: RawSeason[];
  ratings?: {
    tmdb?: number | null;
    trakt?: number | null;
    user?: number | null;
  };
  streamingOn?: string[];
  keywords?: string[];
  matchReason?: string;
  status?: string;
}

const VALID_AVAILABILITY = new Set([
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
]);

const VALID_EPISODE_STATUSES = new Set([
  "available",
  "requested",
  "unavailable",
  "partial",
  "upcoming",
]);

/**
 * Deterministic projection from a raw plugin payload to the canonical
 * `MediaDetail` wire shape. Same input → same output (V85).
 */
// fallow-ignore-next-line complexity
export function mapToMediaDetail(raw: unknown, id: string): MediaDetail {
  const source = (raw && typeof raw === "object" ? raw : {}) as RawDetailItem;
  const { mediaType, tmdbId } = parseId(id, source);
  const out: MediaDetail = {
    id: `${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    title: typeof source.title === "string" ? source.title : `${mediaType}:${tmdbId}`,
  };
  if (typeof source.year === "number" && Number.isFinite(source.year)) {
    out.year = source.year;
  }
  const poster = pickFirst(source.posterUrl, source.poster);
  if (poster) out.poster = poster;
  const backdrop = pickFirst(source.backdropUrl, source.backdrop);
  if (backdrop) out.backdrop = backdrop;
  const clearLogo = pickFirst(source.clearLogoUrl, source.clearLogo);
  if (clearLogo) out.clearLogo = clearLogo;
  if (typeof source.overview === "string" && source.overview.length > 0) {
    out.overview = source.overview;
  }
  if (Array.isArray(source.genres) && source.genres.length > 0) {
    out.genres = source.genres.slice(0, 3);
  }
  if (typeof source.rating === "number" && Number.isFinite(source.rating)) {
    out.rating = source.rating;
  }
  if (typeof source.userRating === "number" && Number.isFinite(source.userRating)) {
    out.userRating = source.userRating;
  }
  if (typeof source.matchReason === "string" && source.matchReason.length > 0) {
    out.matchReason = source.matchReason;
  }
  out.status = normalizeAvailability(source.status);
  if (typeof source.runtime === "number" && Number.isFinite(source.runtime)) {
    out.runtime = formatMinutes(source.runtime);
  } else if (typeof source.runtime === "string" && source.runtime.length > 0) {
    out.runtime = source.runtime;
  }
  if (typeof source.ageRating === "string") out.ageRating = source.ageRating;
  if (typeof source.votes === "number") out.votes = source.votes;
  if (typeof source.audienceScore === "number") out.audienceScore = source.audienceScore;
  if (typeof source.criticScore === "number") out.criticScore = source.criticScore;
  if (Array.isArray(source.tags) && source.tags.length > 0) out.tags = [...source.tags];
  if (typeof source.director === "string" && source.director.length > 0) {
    out.director = source.director;
  }
  if (Array.isArray(source.cast) && source.cast.length > 0) out.cast = [...source.cast];
  if (typeof source.trailerUrl === "string" && source.trailerUrl.length > 0) {
    out.trailerUrl = source.trailerUrl;
  }
  if (source.seriesStatus === "ongoing" || source.seriesStatus === "finished") {
    out.seriesStatus = source.seriesStatus;
  }
  if (typeof source.nextAirDate === "string" && source.nextAirDate.length > 0) {
    out.nextAirDate = source.nextAirDate;
  }
  if (Array.isArray(source.seasons)) {
    out.seasons = source.seasons.map((season, index) =>
      mapSeason(season, index, mediaType, tmdbId),
    );
  }
  const ratings = mapRatings(source.ratings);
  if (ratings) out.ratings = ratings;
  if (Array.isArray(source.streamingOn) && source.streamingOn.length > 0) {
    out.streamingOn = [...source.streamingOn];
  }
  if (Array.isArray(source.keywords) && source.keywords.length > 0) {
    out.keywords = [...source.keywords];
  }
  return out;
}

/**
 * Convenience used by `home/compact.ts` row builders. Maps plugin raw to a
 * `CompactMediaItem` and merges caller-supplied extras (`progress`,
 * `episode`, `matchReason`, etc.) on top.
 */
export function toCompactFromRaw(
  raw: unknown,
  id: string,
  extras: Partial<CompactMediaItem> = {},
): CompactMediaItem {
  const detail = mapToMediaDetail(raw, id);
  const compact = toCompact(detail);
  const merged = { ...compact, ...stripUndefined(extras) };
  // Re-pick to drop any extras keys that aren't compact fields.
  return pick(merged, COMPACT_FIELDS) as CompactMediaItem;
}

function parseId(id: string, source: RawDetailItem): { mediaType: MediaType; tmdbId: string } {
  const parsed = splitCombined(id);
  if (parsed) return parsed;
  const fromSource = splitCombined(source.id);
  if (fromSource) return fromSource;
  const tmdb = source.ids?.tmdb_id;
  const type = source.type;
  if (tmdb && (type === "movie" || type === "tv")) {
    return { mediaType: type, tmdbId: tmdb };
  }
  throw new Error(`mapToMediaDetail: cannot resolve mediaType+tmdbId for id "${id}"`);
}

function splitCombined(value: string | undefined): { mediaType: MediaType; tmdbId: string } | null {
  if (!value) return null;
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const head = value.slice(0, idx);
  const tail = value.slice(idx + 1);
  if (head !== "movie" && head !== "tv") return null;
  if (tail.length === 0) return null;
  return { mediaType: head, tmdbId: tail };
}

function pickFirst(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

function normalizeAvailability(value: string | undefined): MediaDetail["status"] {
  if (typeof value !== "string") return "unknown";
  return VALID_AVAILABILITY.has(value) ? (value as NonNullable<MediaDetail["status"]>) : "unknown";
}

function normalizeEpisodeStatus(value: string | undefined): EpisodeStatus {
  if (typeof value === "string" && VALID_EPISODE_STATUSES.has(value)) {
    return value as EpisodeStatus;
  }
  return "available";
}

function normalizeSeasonStatus(value: string | undefined): SeasonStatus {
  return normalizeEpisodeStatus(value);
}

function mapSeason(
  season: RawSeason,
  index: number,
  mediaType: MediaType,
  tmdbId: string,
): DetailSeason {
  const number = season.number ?? season.season ?? index + 1;
  const id = season.id ?? `${mediaType}:${tmdbId}:s${number}`;
  const title = season.title ?? season.name ?? `Season ${number}`;
  const episodes = Array.isArray(season.episodes)
    ? season.episodes.map((ep, epIdx) => mapEpisode(ep, epIdx, id, season))
    : [];
  const episodeCount = season.episodeCount ?? episodes.length;
  const detail: DetailSeason = {
    id,
    title,
    episodeCount,
    status: normalizeSeasonStatus(season.status),
    episodes,
  };
  if (season.counts && typeof season.counts === "object") {
    const counts = pick(season.counts, ["available", "requested", "upcoming"]);
    if (Object.keys(counts).length > 0) detail.counts = counts;
  }
  return detail;
}

function mapEpisode(
  episode: RawSeasonEpisode,
  index: number,
  seasonId: string,
  season: RawSeason,
): DetailEpisode {
  const number = episode.episode ?? episode.number ?? index + 1;
  const id = episode.id ?? `${seasonId}:e${number}`;
  const title = episode.title ?? episode.name ?? `Episode ${number}`;
  const airDate = episode.airDate ?? episode.aired ?? "";
  const runtime = typeof episode.runtime === "number" ? episode.runtime : 0;
  const status = normalizeEpisodeStatus(episode.status ?? season.status);
  return {
    id,
    episode: number,
    title,
    airDate,
    runtime,
    status,
  };
}

function mapRatings(raw: RawDetailItem["ratings"]): NonNullable<MediaDetail["ratings"]> | null {
  if (!raw) return null;
  const out: NonNullable<MediaDetail["ratings"]> = {};
  if (typeof raw.tmdb === "number") out.tmdb = raw.tmdb;
  if (typeof raw.trakt === "number") out.trakt = raw.trakt;
  if (typeof raw.user === "number") out.user = raw.user;
  return Object.keys(out).length > 0 ? out : null;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (!isNil(v)) out[k] = v;
  }
  return out;
}
