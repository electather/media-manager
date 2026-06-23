/**
 * Only layout key is home-owned; row/detail reads route through mediaKeys.
 * Layout must NOT be swept by mediaKeys.root invalidation (#505).
 */
export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
} as const;
