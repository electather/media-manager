import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { MediaType } from "@ent-mcp/shared/media";
import type { WatchedState } from "@ent-mcp/shared/library";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

/**
 * An owned row that needs hydrating, carrying just the identity the orchestrator
 * fans out on. The denormalized columns are deliberately omitted — the hydrate
 * pass overwrites them wholesale, so reading the stale values back would only
 * waste a column scan.
 */
export interface HydrateTarget {
  id: string;
  tmdbId: string;
  mediaType: MediaType;
}

/**
 * The denormalized columns one hydrate pass computes for a single row. Every
 * field is overwritten wholesale: a column the source could not resolve falls
 * back to its empty/null shape rather than being left at a prior value, so a
 * title that lost its last server copy correctly hydrates to an empty
 * `servers`. `hydratedAt` is stamped by `writeHydration`, not the caller.
 */
export interface HydrationUpdate {
  id: string;
  sortTitle: string;
  year: number | null;
  genres: string[];
  servers: { id: string; label: string }[];
  qualityTiers: string[];
  watchedState: WatchedState | null;
  collectionId: string | null;
  collectionName: string | null;
}

/**
 * Returns the owned rows for `userId` whose denormalized projection is missing
 * (`hydrated_at IS NULL`) or stale (`hydrated_at < now - staleTtlMs`). The
 * caller fans availability/metadata/progress lookups out over exactly this set,
 * so a fully-fresh library returns an empty array and costs only one indexed
 * read (design §Sync + hydrate, phase 2). Tombstoned rows (`owned = false`) are
 * excluded — only the live owned set is browsable, so spending a fan-out on a
 * tombstone would be wasted work.
 */
export async function staleOrNew(
  userId: string,
  staleTtlMs: number,
  now: number,
  db: Db = getDb(),
): Promise<HydrateTarget[]> {
  const staleBefore = now - staleTtlMs;
  return db
    .select({
      id: libraryItems.id,
      tmdbId: libraryItems.tmdbId,
      mediaType: libraryItems.mediaType,
    })
    .from(libraryItems)
    .where(
      and(
        eq(libraryItems.userId, userId),
        eq(libraryItems.owned, true),
        or(isNull(libraryItems.hydratedAt), lt(libraryItems.hydratedAt, staleBefore)),
      ),
    );
}

/**
 * Writes the denormalized projection for each hydrated row, stamping
 * `hydrated_at = now` so a later `staleOrNew` skips it until the TTL elapses.
 * One `UPDATE` per row keyed by the composite primary key; the set is bounded by
 * the page of rows `staleOrNew` returned, so this stays O(stale rows). Rows are
 * updated in id order so a partial failure leaves a deterministic prefix
 * hydrated rather than an arbitrary scatter.
 */
export async function writeHydration(
  updates: HydrationUpdate[],
  now: number,
  db: Db = getDb(),
): Promise<number> {
  if (updates.length === 0) return 0;
  let written = 0;
  for (const update of updates) {
    await db
      .update(libraryItems)
      .set({
        sortTitle: update.sortTitle,
        year: update.year,
        genres: update.genres,
        servers: update.servers,
        qualityTiers: update.qualityTiers,
        watchedState: update.watchedState,
        collectionId: update.collectionId,
        collectionName: update.collectionName,
        hydratedAt: now,
      })
      .where(eq(libraryItems.id, update.id));
    written += 1;
  }
  return written;
}
