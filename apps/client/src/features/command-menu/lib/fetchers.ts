import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { SearchKind } from "@ent-mcp/shared/search";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";
import { safeJson } from "@/shared/lib/errors/safe-json";

import { CommandMenuApiError } from "./errors";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new CommandMenuApiError(res.status, body);
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
  return res.json() as Promise<SearchResult>;
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
  return res.json() as Promise<SearchResult>;
}
