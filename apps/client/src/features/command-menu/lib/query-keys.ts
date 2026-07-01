import { SEARCH_KINDS, type SearchKind } from "@nama/shared/search";

import type { TrendingScope } from "./fetchers";

export const commandMenuKeys = {
  all: ["command-menu"] as const,
  search: (q: string, kind: SearchKind) => [...commandMenuKeys.all, "search", { q, kind }] as const,
  trending: (mediaType: TrendingScope) =>
    [...commandMenuKeys.all, "trending", { mediaType }] as const,
} as const;

function hasSearchParam(value: unknown): value is { q: string; kind: SearchKind } {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.q === "string" && (SEARCH_KINDS as readonly unknown[]).includes(v.kind);
}

/** Type-safe guard for search query-keys produced by {@link commandMenuKeys.search}. */
export function isSearchKey(
  key: readonly unknown[],
): key is ReturnType<typeof commandMenuKeys.search> {
  return key[0] === "command-menu" && key[1] === "search" && hasSearchParam(key[2]);
}
