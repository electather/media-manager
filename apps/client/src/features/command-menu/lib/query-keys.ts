import type { SearchKind } from "@nama/shared/search";

import type { TrendingScope } from "./fetchers";

export const commandMenuKeys = {
  all: ["command-menu"] as const,
  search: (q: string, kind: SearchKind) => [...commandMenuKeys.all, "search", { q, kind }] as const,
  trending: (mediaType: TrendingScope) =>
    [...commandMenuKeys.all, "trending", { mediaType }] as const,
} as const;

/** Type-safe guard for search query-keys produced by {@link commandMenuKeys.search}. */
export function isSearchKey(
  key: readonly unknown[],
): key is ReturnType<typeof commandMenuKeys.search> {
  return (
    key[0] === "command-menu" &&
    key[1] === "search" &&
    key[2] !== null &&
    typeof key[2] === "object" &&
    "kind" in (key[2] as object)
  );
}
