import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { AuthApiError, type TrendingPoster } from "./types";

/**
 * Public trending-posters read for the decorative auth-page grid. Calls
 * `GET /api/public/trending` with no session (the same RPC client as every
 * other request) and returns the minimal poster projection. The server already
 * returns `200` with an empty list when the feed is unavailable, so this only
 * throws on genuine transport/HTTP failures.
 */
export async function fetchTrendingPosters(limit: number): Promise<TrendingPoster[]> {
  const res = await api.public.trending.$get({ query: { limit: String(limit) } });
  const data = await readOkJson(res, AuthApiError);
  return data.posters;
}
