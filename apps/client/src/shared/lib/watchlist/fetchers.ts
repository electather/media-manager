import type {
  AddWatchlistRequest,
  AddWatchlistResponse,
  WatchlistBucket,
  WatchlistCounts,
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

export interface FetchWatchlistArgs {
  cursor?: string;
  limit?: number;
  filter?: WatchlistBucket;
}

// fallow-ignore-next-line complexity
export async function fetchWatchlist(args: FetchWatchlistArgs = {}): Promise<WatchlistResponse> {
  const query: Record<string, string> = {};
  if (args.cursor) query.cursor = args.cursor;
  if (args.limit != null) query.limit = String(args.limit);
  if (args.filter) query.filter = args.filter;
  const res = await api.watchlist.$get({ query });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistResponse;
}

export async function fetchWatchlistCounts(): Promise<WatchlistCounts> {
  const res = await api.watchlist.counts.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistCounts;
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
