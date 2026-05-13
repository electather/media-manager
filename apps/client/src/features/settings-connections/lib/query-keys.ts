export const settingsConnectionsKeys = {
  all: ["settings-connections"] as const,
  connections: () => [...settingsConnectionsKeys.all, "connections"] as const,
  availablePlugins: () => [...settingsConnectionsKeys.all, "available-plugins"] as const,
} as const;
