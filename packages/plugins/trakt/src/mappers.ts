import type { TraktMovie, TraktShow, TraktMediaItemRef } from "./types";

// Returns null when id is missing or non-integer — Trakt rejects `{ trakt: null }`
// and parseInt("42abc") would silently succeed under a looser check.
export function parseTraktId(id: string | undefined): number | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return parseInt(id, 10);
}

// Splits a mixed movie/tv array into the Trakt request-body shape.
// Items with missing or non-numeric trakt ids are dropped — null ids produce 4xx errors.
function splitByType(items: TraktMediaItemRef[]): {
  movies: Array<{ ids: { trakt: number } }>;
  shows: Array<{ ids: { trakt: number } }>;
} {
  const movies: Array<{ ids: { trakt: number } }> = [];
  const shows: Array<{ ids: { trakt: number } }> = [];
  for (const i of items) {
    const n = parseTraktId(i.ids?.trakt_id);
    if (n === null) continue;
    if (i.type === "movie") movies.push({ ids: { trakt: n } });
    else if (i.type === "tv") shows.push({ ids: { trakt: n } });
  }
  return { movies, shows };
}

export function mapMovie(m: TraktMovie) {
  return {
    id: `movie:${m.ids.tmdb ?? m.ids.trakt}`,
    title: m.title,
    year: m.year ?? null,
    type: "movie" as const,
    genres: [],
    rating: null,
    overview: m.overview ?? "",
    posterUrl: null,
    ids: {
      tmdb_id: m.ids.tmdb ? String(m.ids.tmdb) : undefined,
      trakt_id: String(m.ids.trakt),
      trakt_slug: m.ids.slug,
      imdb_id: m.ids.imdb,
    },
  };
}

// Serializes a mixed-type item list into the JSON body shape Trakt sync
// endpoints expect. Used by all add/remove sync write operations.
export function toSyncBody(items: TraktMediaItemRef[]): string {
  const { movies, shows } = splitByType(items);
  return JSON.stringify({ movies, shows });
}

export function mapShow(s: TraktShow) {
  return {
    id: `tv:${s.ids.tmdb ?? s.ids.trakt}`,
    title: s.title,
    year: s.year ?? null,
    type: "tv" as const,
    genres: [],
    rating: null,
    overview: s.overview ?? "",
    posterUrl: null,
    ids: {
      tmdb_id: s.ids.tmdb ? String(s.ids.tmdb) : undefined,
      trakt_id: String(s.ids.trakt),
      trakt_slug: s.ids.slug,
      tvdb_id: s.ids.tvdb ? String(s.ids.tvdb) : undefined,
      imdb_id: s.ids.imdb,
    },
  };
}
