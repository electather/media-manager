import type {
  AddWatchlistRequest,
  AddWatchlistResponse,
  WatchlistResponse,
} from "@ent-mcp/shared/watchlist";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";
import { WatchlistApiError } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new WatchlistApiError(res.status, body);
}

export async function fetchWatchlist(): Promise<WatchlistResponse> {
  const res = await api.watchlist.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistResponse;
}

export async function addToWatchlist(input: AddWatchlistRequest): Promise<AddWatchlistResponse> {
  const res = await api.watchlist.$post({ json: input });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as AddWatchlistResponse;
}

export async function removeFromWatchlist(
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<void> {
  const res = await api.watchlist[":tmdbId"][":mediaType"].$delete({
    param: { tmdbId, mediaType },
  });
  if (!res.ok) await throwOnError(res);
}
