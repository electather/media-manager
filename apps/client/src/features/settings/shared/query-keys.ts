export const settingsKeys = {
  all: ["settings"] as const,
  publicConfig: () => [...settingsKeys.all, "public-config"] as const,
  role: () => [...settingsKeys.all, "role"] as const,
} as const;
