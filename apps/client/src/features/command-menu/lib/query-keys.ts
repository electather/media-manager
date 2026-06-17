import type { SearchKind } from "@nama/shared/search";

import type { TrendingScope } from "./fetchers";

export const commandMenuKeys = {
  all: ["command-menu"] as const,
  search: (q: string, kind: SearchKind) => [...commandMenuKeys.all, "search", { q, kind }] as const,
  trending: (mediaType: TrendingScope) =>
    [...commandMenuKeys.all, "trending", { mediaType }] as const,
} as const;

function hasKindParam(value: unknown): value is { kind: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "kind" in (value as object) &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

/** Type-safe guard for search query-keys produced by {@link commandMenuKeys.search}. */
export function isSearchKey(
  key: readonly unknown[],
): key is ReturnType<typeof commandMenuKeys.search> {
  return key[0] === "command-menu" && key[1] === "search" && hasKindParam(key[2]);
}
