/** Layout key is home-owned; row/detail route through shared `mediaKeys` (design §B3 / V.CL1).
 *  Layout NOT swept by `mediaKeys.root` invalidation from watchlist mutation (#505).
 */
export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
} as const;
