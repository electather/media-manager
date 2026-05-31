/**
 * Query-keys factory for the home feature. Row + detail reads now route through
 * the shared `mediaKeys` (design §B3 / invariant V.CL1) — rows via
 * `mediaKeys.source(rowId, {})` (the `homeRowSource` descriptor) and the detail
 * modal via `mediaKeys.title(...)` in `useHomeDetails`.
 *
 * Only the home *layout* keeps a home-owned key: `/home/layout` is a
 * home-specific resource that survives cutover and must NOT be swept by the
 * shared `mediaKeys.root` invalidation a watchlist mutation fires (#505) — the
 * layout's hero + row stubs do not depend on watchlist membership.
 */
export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
} as const;
