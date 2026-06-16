export const settingsAppsKeys = {
  all: ["settings-apps"] as const,
  authorizedApps: () => [...settingsAppsKeys.all, "authorized-apps"] as const,
} as const;
