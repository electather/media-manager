import type { MediaType } from "@ent-mcp/shared/media";
import type { AddWatchlistRequest, AddWatchlistResponse } from "@ent-mcp/shared/watchlist";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

/**
 * The one media write surface (design §A6/§B2). Both watchlist mutations and
 * any cross-feature toggle (home cards, search rows) bind here instead of a
 * per-feature fetcher, so add/remove flow through `api.media.*` exactly once.
 */
export async function addToWatchlist(input: AddWatchlistRequest): Promise<AddWatchlistResponse> {
  const res = await api.media.watchlist.$post({ json: input });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as AddWatchlistResponse;
}

export async function removeFromWatchlist(tmdbId: string, type: MediaType): Promise<void> {
  const res = await api.media.watchlist[":type"][":tmdbId"].$delete({ param: { type, tmdbId } });
  if (!res.ok) await throwOnError(res);
}
