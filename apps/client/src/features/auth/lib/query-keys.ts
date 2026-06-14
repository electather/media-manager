/**
 * Query-keys factory for the auth feature. Only the decorative public trending
 * posters read is cached here; auth mutations (login, register, reset) are
 * fire-and-forget and own no query keys.
 */
export const authKeys = {
  all: ["auth"] as const,
  trendingPosters: (limit: number) => [...authKeys.all, "trending-posters", limit] as const,
} as const;
