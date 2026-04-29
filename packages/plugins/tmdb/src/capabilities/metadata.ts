import type { Ctx, MovieRaw, TvRaw, DiscoverFilters } from "../types";
import { parseMediaInput } from "../types";
import { tmdbGet } from "../client";
import { mapMovie, mapShow } from "../mappers";
import { SORT_MAP_MOVIE, SORT_MAP_TV } from "../constants";

function msToIsoDate(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}

function buildDiscoverParams(
  kind: "movie" | "tv",
  filters: DiscoverFilters,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (filters.genres?.length) params["with_genres"] = filters.genres.join(",");
  if (filters.ratingMin !== undefined) params["vote_average.gte"] = filters.ratingMin;
  // Explicit ms-epoch bounds win over year-only bounds when both are set —
  // they describe a precise window where year filters describe the
  // calendar-year envelope. Apply yearMin/yearMax first, then let the more
  // specific releaseDateGte/Lte overwrite.
  const dateGteKey = kind === "movie" ? "primary_release_date.gte" : "first_air_date.gte";
  const dateLteKey = kind === "movie" ? "primary_release_date.lte" : "first_air_date.lte";
  if (filters.yearMin !== undefined) params[dateGteKey] = `${filters.yearMin}-01-01`;
  if (filters.yearMax !== undefined) params[dateLteKey] = `${filters.yearMax}-12-31`;
  if (filters.gteIso) params[dateGteKey] = filters.gteIso;
  if (filters.lteIso) params[dateLteKey] = filters.lteIso;
  if (filters.sort) {
    const map = kind === "movie" ? SORT_MAP_MOVIE : SORT_MAP_TV;
    params["sort_by"] = map[filters.sort];
  }
  return params;
}

/**
 * Round-robin merge so a mixed-media row alternates movie / TV / movie /
 * TV rather than dumping every movie before the first show. Both upstream
 * arrays already arrive sorted by the same key (`sort_by` is identical
 * across endpoints), so alternating preserves the relative order of each
 * side without a numeric merge key the raw responses don't carry.
 */
function interleave<A, B>(a: A[], b: B[]): Array<A | B> {
  const out: Array<A | B> = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

export const metadata = {
  async search(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const {
      query,
      type,
      limit = 20,
    } = input as { query: string; type?: "movie" | "tv"; limit?: number };
    if (type === "movie") {
      const data = (await tmdbGet(c, "/search/movie", { query })) as { results: MovieRaw[] };
      return data.results.slice(0, limit).map((r) => ({ item: mapMovie(c, r), score: 1 }));
    }
    if (type === "tv") {
      const data = (await tmdbGet(c, "/search/tv", { query })) as { results: TvRaw[] };
      return data.results.slice(0, limit).map((r) => ({ item: mapShow(c, r), score: 1 }));
    }
    const data = (await tmdbGet(c, "/search/multi", { query })) as {
      results: Array<{ media_type: string } & MovieRaw & TvRaw>;
    };
    return data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, limit)
      .map((r) => ({
        item: r.media_type === "movie" ? mapMovie(c, r) : mapShow(c, r),
        score: 1,
      }));
  },

  async getDetails(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { id, type } = parseMediaInput(input);
    const data = await tmdbGet(c, `/${type}/${id}`, {
      append_to_response: "external_ids,credits,keywords",
    });
    return type === "movie" ? mapMovie(c, data as MovieRaw) : mapShow(c, data as TvRaw);
  },

  async getSimilar(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { id, type } = parseMediaInput(input);
    const data = (await tmdbGet(c, `/${type}/${id}/similar`)) as { results: unknown[] };
    return (data.results as Array<MovieRaw & TvRaw>).map((r) =>
      type === "movie" ? mapMovie(c, r) : mapShow(c, r),
    );
  },

  async getTrending(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type = "movie", limit = 20 } = input as { type?: "movie" | "tv"; limit?: number };
    const data = (await tmdbGet(c, `/trending/${type}/day`)) as { results: unknown[] };
    return (data.results as Array<MovieRaw & TvRaw>)
      .slice(0, limit)
      .map((r) => (type === "movie" ? mapMovie(c, r) : mapShow(c, r)));
  },

  async discover(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const {
      genres,
      yearMin,
      yearMax,
      ratingMin,
      limit = 20,
      releaseDateGte,
      releaseDateLte,
      sort,
    } = input as {
      genres?: string[];
      yearMin?: number;
      yearMax?: number;
      ratingMin?: number;
      limit?: number;
      releaseDateGte?: number;
      releaseDateLte?: number;
      sort?: "popularity_desc" | "popularity_asc" | "release_date_desc" | "release_date_asc";
    };
    const filters: DiscoverFilters = {
      genres,
      yearMin,
      yearMax,
      ratingMin,
      gteIso: msToIsoDate(releaseDateGte),
      lteIso: msToIsoDate(releaseDateLte),
      sort,
    };
    const [movieRes, tvRes] = await Promise.allSettled([
      tmdbGet(c, "/discover/movie", buildDiscoverParams("movie", filters)) as Promise<{
        results: MovieRaw[];
      }>,
      tmdbGet(c, "/discover/tv", buildDiscoverParams("tv", filters)) as Promise<{
        results: TvRaw[];
      }>,
    ]);
    // Both endpoints failing is the only path that re-throws — surfacing
    // the movie reason matches the legacy contract (movie was the sole
    // endpoint before this fix). One side fulfilled is enough to render
    // the row, even if mixed-media intent is degraded for that response.
    if (movieRes.status === "rejected" && tvRes.status === "rejected") {
      throw movieRes.reason;
    }
    const movies =
      movieRes.status === "fulfilled" ? movieRes.value.results.map((r) => mapMovie(c, r)) : [];
    const shows = tvRes.status === "fulfilled" ? tvRes.value.results.map((s) => mapShow(c, s)) : [];
    return interleave(movies, shows).slice(0, limit);
  },
};
