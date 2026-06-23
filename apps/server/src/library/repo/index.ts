import { getDb, type Db } from "../../db/client";
import { libraryItems, userLibrarySeed } from "../../db/schema/library";

/**
 * Repo barrel: Drizzle only under `repo/` (one file per concern) per backend-feature-architecture
 * (R2). Service, internal, sources, jobs import here — never reach for drizzle-orm directly.
 * Path `"../repo"` stays stable as file was promoted to directory.
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
