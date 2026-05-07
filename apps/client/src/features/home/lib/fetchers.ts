import type {
  HomeLayoutResponse,
  MediaDetailsResponse,
  RowContentResponse,
} from "@ent-mcp/shared/home";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";
import { safeJson } from "@/shared/lib/errors/safe-json";
import { HomeApiError } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new HomeApiError(res.status, body);
}

export async function fetchHomeLayout(): Promise<HomeLayoutResponse> {
  const res = await api.home.layout.$get({ query: {} });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as HomeLayoutResponse;
}

export async function fetchHomeRow(
  rowId: string,
  cursor: string | null,
): Promise<RowContentResponse> {
  const res = await api.home.row.$get({
    query: { rowId, ...(cursor ? { cursor } : {}) },
  });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as RowContentResponse;
}

export async function fetchHomeDetails(
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<MediaDetailsResponse> {
  const res = await api.home.details.$get({ query: { tmdbId, mediaType } });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as MediaDetailsResponse;
}
