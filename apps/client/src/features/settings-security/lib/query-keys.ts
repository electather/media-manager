export const settingsSecurityKeys = {
  all: ["settings-security"] as const,
  sessions: () => [...settingsSecurityKeys.all, "sessions"] as const,
} as const;
