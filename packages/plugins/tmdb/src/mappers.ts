import type { Ctx, MovieRaw, TvRaw, Genre, Credits } from "./types";
import { buildPosterUrl } from "./images";

export function mapGenres(genres: Genre[] | undefined, genreIds: number[] | undefined): string[] {
  if (genres && genres.length > 0) return genres.map((g) => g.name);
  // Search endpoints return genre_ids only; details endpoints return full genre objects.
  return genreIds ? genreIds.map(String) : [];
}

function mapCast(credits: Credits | undefined): string[] {
  return (credits?.cast ?? []).map((m) => m.name);
}

function mapDirector(credits: Credits | undefined): string | null {
  return credits?.crew?.find((m) => m.job === "Director")?.name ?? null;
}

function mapWriters(credits: Credits | undefined): string[] {
  return (credits?.crew ?? []).filter((m) => m.department === "Writing").map((m) => m.name);
}

function mapMovieKeywords(kw: MovieRaw["keywords"]): string[] {
  return (kw?.keywords ?? []).map((k) => k.name);
}

function mapTvKeywords(kw: TvRaw["keywords"]): string[] {
  return (kw?.results ?? []).map((k) => k.name);
}

export function mapMovie(ctx: Ctx, m: MovieRaw): unknown {
  const imdb = m.external_ids?.imdb_id ?? m.imdb_id ?? undefined;
  const tvdb = m.external_ids?.tvdb_id ? String(m.external_ids.tvdb_id) : undefined;
  return {
    id: `movie:${m.id}`,
    title: m.title || m.original_title || "",
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    type: "movie",
    genres: mapGenres(m.genres, m.genre_ids),
    runtime: m.runtime ?? null,
    originalLanguage: m.original_language ?? null,
    cast: mapCast(m.credits),
    director: mapDirector(m.credits),
    writers: mapWriters(m.credits),
    keywords: mapMovieKeywords(m.keywords),
    rating: m.vote_average ?? null,
    overview: m.overview ?? "",
    posterUrl: buildPosterUrl(ctx, m.poster_path ?? null),
    ids: {
      tmdb_id: String(m.id),
      imdb_id: imdb || undefined,
      tvdb_id: tvdb,
    },
  };
}

export function mapShow(ctx: Ctx, s: TvRaw): unknown {
  const imdb = s.external_ids?.imdb_id ?? undefined;
  const tvdb = s.external_ids?.tvdb_id ? String(s.external_ids.tvdb_id) : undefined;
  return {
    id: `tv:${s.id}`,
    title: s.name || s.original_name || "",
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    type: "tv",
    genres: mapGenres(s.genres, s.genre_ids),
    runtime: s.episode_run_time?.[0] ?? null,
    originalLanguage: s.original_language ?? null,
    cast: mapCast(s.credits),
    creators: (s.created_by ?? []).map((c) => c.name),
    keywords: mapTvKeywords(s.keywords),
    rating: s.vote_average ?? null,
    overview: s.overview ?? "",
    posterUrl: buildPosterUrl(ctx, s.poster_path ?? null),
    ids: {
      tmdb_id: String(s.id),
      imdb_id: imdb || undefined,
      tvdb_id: tvdb,
    },
  };
}
