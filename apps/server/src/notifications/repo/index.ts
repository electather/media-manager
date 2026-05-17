/**
 * Repo barrel for the notifications module. Aggregates every named function
 * across `deliveries.ts`, `inbox.ts`, `subscriptions.ts`, and `settings.ts`.
 * `service.ts` imports as `import * as repo from "./repo"` and calls
 * `repo.fn()` so drizzle-orm stays isolated below this barrier.
 */
export * from "./deliveries";
export * from "./inbox";
export * from "./subscriptions";
export * from "./settings";
