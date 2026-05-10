export const settingsKeys = {
  all: ["settings"] as const,
  publicConfig: () => [...settingsKeys.all, "public-config"] as const,
  role: () => [...settingsKeys.all, "role"] as const,
  sessions: () => [...settingsKeys.all, "sessions"] as const,
  apps: () => [...settingsKeys.all, "apps"] as const,
} as const;
