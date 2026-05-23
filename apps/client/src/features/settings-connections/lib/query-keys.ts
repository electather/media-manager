export const settingsConnectionsKeys = {
  all: ["settings-connections"] as const,
  connections: () => [...settingsConnectionsKeys.all, "connections"] as const,
  availablePlugins: () => [...settingsConnectionsKeys.all, "available-plugins"] as const,
  primary: () => [...settingsConnectionsKeys.all, "primary"] as const,
} as const;
