/**
 * Query-key factory for the onboarding feature. `publicConfig` uses a top-level,
 * app-wide key because the public config is the canonical pre-session cache read
 * by the root route guard, distinct from any settings-scoped duplicates.
 */
export const onboardingKeys = {
  all: ["onboarding"] as const,
  state: () => [...onboardingKeys.all, "state"] as const,
  publicConfig: () => ["public-config"] as const,
} as const;
