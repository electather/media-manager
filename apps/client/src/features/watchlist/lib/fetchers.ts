import type {
  AddWatchlistRequest,
  AddWatchlistResponse,
  MoodId,
  WatchlistBucket,
  WatchlistCounts,
  WatchlistMoodSummary,
  WatchlistResponse,
  WatchlistSectionResponse,
  WatchlistSort,
} from "@ent-mcp/shared/watchlist";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";
import { WatchlistApiError } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new WatchlistApiError(res.status, body);
}

export interface FetchItemsArgs {
  cursor?: string;
  limit?: number;
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

// fallow-ignore-next-line complexity
export async function fetchItems(args: FetchItemsArgs = {}): Promise<WatchlistResponse> {
  const query: Record<string, string> = {};
  if (args.cursor) query.cursor = args.cursor;
  if (args.limit != null) query.limit = String(args.limit);
  if (args.sort) query.sort = args.sort;
  if (args.bucket) query.bucket = args.bucket;
  if (args.mood) query.mood = args.mood;
  const res = await api.watchlist.items.$get({ query });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistResponse;
}

export async function fetchCounts(): Promise<WatchlistCounts> {
  const res = await api.watchlist.counts.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistCounts;
}

export async function fetchTonight(): Promise<WatchlistSectionResponse> {
  const res = await api.watchlist.sections.tonight.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistSectionResponse;
}

export interface FetchRecentlyArgs {
  limit?: number;
}

export async function fetchRecently(
  args: FetchRecentlyArgs = {},
): Promise<WatchlistSectionResponse> {
  const query: Record<string, string> = {};
  if (args.limit != null) query.limit = String(args.limit);
  const res = await api.watchlist.sections.recently.$get({ query });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistSectionResponse;
}

export async function fetchMoods(): Promise<WatchlistMoodSummary> {
  const res = await api.watchlist.moods.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as WatchlistMoodSummary;
}

export interface FetchMoodItemsArgs {
  cursor?: string;
  limit?: number;
}

export async function fetchMoodItems(
  moodId: MoodId,
  args: FetchMoodItemsArgs = {},
): Promise<WatchlistResponse> {
  const query: Record<string, string> = {};
  if (args.cursor) query.cursor = args.cursor;
  if (args.limit != null) query.limit = String(args.limit);
  const res = await api.watchlist.moods[":moodId"].items.$get({
    param: { moodId },
    query,
  });
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
