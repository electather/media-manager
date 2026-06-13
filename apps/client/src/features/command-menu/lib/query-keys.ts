import type { SearchKind } from "@nama/shared/search";

import type { TrendingScope } from "./fetchers";

export const commandMenuKeys = {
  all: ["command-menu"] as const,
  search: (q: string, kind: SearchKind) => [...commandMenuKeys.all, "search", { q, kind }] as const,
  trending: (mediaType: TrendingScope) =>
    [...commandMenuKeys.all, "trending", { mediaType }] as const,
} as const;
