/**
 * Repo barrel for the preferences module. Aggregates every named function
 * across `feedback.ts` (feedback row CRUD + rebuild row source) and
 * `storage.ts` (preference profile blob read/write). Internal helpers and
 * service code import as `import * as repo from "./repo"` and call
 * `repo.fn()` so drizzle-orm stays isolated below this barrier.
 */
export * from "./feedback";
export * from "./storage";
