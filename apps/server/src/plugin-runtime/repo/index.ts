/**
 * Repo barrel for plugin-runtime. Owns all drizzle-orm imports and `plugins`-table access.
 * Imported as `import * as repo from "../repo"` — keeps drizzle-orm isolated below this barrier.
 */
export * from "./plugins";
