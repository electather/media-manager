/**
 * Query-keys factory for the home feature. All consumers — hooks,
 * mutations, ErrorBoundary reset — read from here so the cache stays
 * uniformly addressable.
 */
export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
  rowsAll: () => [...homeKeys.all, "row"] as const,
  row: (rowId: string, initialCursor: string | null) =>
    [...homeKeys.all, "row", rowId, initialCursor] as const,
  details: (tmdbId: string | null, mediaType: "movie" | "tv" | null) =>
    [...homeKeys.all, "details", tmdbId, mediaType] as const,
} as const;
