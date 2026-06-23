/**
 * Only the layout key is home-owned; row/detail reads route through the shared
 * `mediaKeys` (design §B3 / invariant V.CL1). Layout must NOT be swept by the
 * `mediaKeys.root` invalidation a watchlist mutation fires (#505) — its hero +
 * row stubs don't depend on watchlist membership.
 */
export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
} as const;
