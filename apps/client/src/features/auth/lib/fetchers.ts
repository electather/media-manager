import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { AuthApiError, type TrendingPoster } from "./types";

/** Fetches public trending posters for auth-page grid. Returns empty list when unavailable (not an error). */
export async function fetchTrendingPosters(limit: number): Promise<TrendingPoster[]> {
  const res = await api.public.trending.$get({ query: { limit: String(limit) } });
  const data = await readOkJson(res, AuthApiError);
  return data.posters;
}
