export const settingsAppsKeys = {
  all: ["settings-apps"] as const,
  publicConfig: () => [...settingsAppsKeys.all, "public-config"] as const,
  authorizedApps: () => [...settingsAppsKeys.all, "authorized-apps"] as const,
} as const;
