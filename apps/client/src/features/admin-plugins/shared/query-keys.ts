export const adminPluginsKeys = {
  all: ["admin", "plugins"] as const,
  list: () => [...adminPluginsKeys.all, "list"] as const,
  globalConfig: (pluginId: string) => [...adminPluginsKeys.all, pluginId, "global-config"] as const,
  sharedCredentials: (pluginId: string) =>
    [...adminPluginsKeys.all, pluginId, "shared-credentials"] as const,
} as const;
