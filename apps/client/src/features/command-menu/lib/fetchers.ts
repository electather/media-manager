import type { CompactMediaItem } from "@nama/shared/home";
import { discoverTrendingResponseSchema } from "@nama/shared/media";
import { searchResponseSchema, type SearchKind } from "@nama/shared/search";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new BaseApiError(
    "CommandMenuApiError",
    res.status,
    body,
    `command-menu request failed (${res.status})`,
  );
}

export interface SearchResult {
  results: CompactMediaItem[];
  hasMore: boolean;
}

export type TrendingScope = "tv" | "movie";

export async function fetchSearch(input: {
  q: string;
  kind: SearchKind;
  limit?: number;
}): Promise<SearchResult> {
  const res = await api.search.$get({
    query: {
      q: input.q,
      kind: input.kind,
      ...(input.limit ? { limit: String(input.limit) } : {}),
    },
  });
  if (!res.ok) await throwOnError(res);
  // Validate against the shared schema — `Response.json()` returns `unknown`,
  // so without a parse a malformed 2xx body would silently corrupt the menu.
  return searchResponseSchema.parse(await res.json()) as SearchResult;
}

export async function fetchTrending(input: {
  mediaType: TrendingScope;
  limit?: number;
}): Promise<SearchResult> {
  const res = await api.discover.trending.$get({
    query: {
      mediaType: input.mediaType,
      ...(input.limit ? { limit: String(input.limit) } : {}),
    },
  });
  if (!res.ok) await throwOnError(res);
  return discoverTrendingResponseSchema.parse(await res.json()) as SearchResult;
}
