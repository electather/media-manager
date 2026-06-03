import { getDb, type Db } from "../../db/client";
import { libraryItems, userLibrarySeed } from "../../db/schema/library";

/**
 * Repo barrel for `library/`. Drizzle lives only under `repo/` (one file per
 * concern) per the `backend-feature-architecture` skill (R2); `service.ts`,
 * `internal/`, `sources/`, and `jobs/` import these functions and never reach
 * for `drizzle-orm` directly. The path `"../repo"` stays stable for callers as
 * the file was promoted to a directory.
 */
export { upsertOwned, tombstoneMissing, allKnownKeys, type OwnedRowInput } from "./membership";
export { trySeedLock, clearSeedLock, listSeededUserIds } from "./seed";
export { staleOrNew, writeHydration, type HydrateTarget, type HydrationUpdate } from "./hydrate";
export {
  selectAzPage,
  selectTimelinePage,
  selectServerPage,
  selectQualityPage,
  type LensFilters,
  type AzCursor,
  type TimelineCursor,
  type ServerCursor,
  type QualityCursor,
} from "./lens-pages";
export { selectFacets } from "./facets";
export {
  selectCollections,
  selectRowsByIds,
  type CollectionCursor,
  type CollectionGroup,
  type CollectionsPage,
} from "./collections";

/** Test-only: drop all library projection + seed data. */
export async function __resetLibraryForTests(db: Db = getDb()): Promise<void> {
  await db.delete(libraryItems);
  await db.delete(userLibrarySeed);
}
