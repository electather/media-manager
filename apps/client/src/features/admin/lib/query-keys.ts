// Cache hierarchy mirrors parent plugins namespace for shared invalidation. Lives here (not admin-plugins) due to architecture boundary.
export const adminKeys = {
  all: ["admin", "plugins"] as const,
  sharedCredentials: (pluginId: string) =>
    [...adminKeys.all, pluginId, "shared-credentials"] as const,
} as const;
