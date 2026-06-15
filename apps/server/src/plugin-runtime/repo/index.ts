/**
 * Repo barrel for the plugin-runtime module. Owns every drizzle-orm import and
 * `plugins`-table access. `service/runtime.ts` imports as
 * `import * as repo from "../repo"` and calls `repo.fn()` so drizzle-orm stays
 * isolated below this barrier.
 */
export * from "./plugins";
