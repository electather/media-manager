import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import type { WatchedState } from "@nama/shared/library";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

/**
 * Denormalized columns are omitted — hydrate pass overwrites them wholesale,
 * so reading stale values would waste a column scan.
 */
export interface HydrateTarget {
  id: string;
  tmdbId: string;
  mediaType: MediaType;
}

/**
 * Every field overwrites wholesale: unresolved columns fall back to empty/null,
 * not prior values. `hydratedAt` stamped by writeHydration, not caller.
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
 * Returns rows where `hydrated_at IS NULL` or `hydrated_at < now - staleTtlMs`,
 * ordered by composite id for deterministic chunking (design §Sync + hydrate, phase 2).
 * Tombstoned rows (`owned = false`) excluded; resumable on timeout.
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
    )
    .orderBy(libraryItems.id);
}

/**
 * Updates rows in id order (O(stale rows)) so partial failure leaves deterministic
 * prefix hydrated. Stamps `hydrated_at = now` so staleOrNew skips until TTL.
 */
export async function writeHydration(
  userId: string,
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
      .where(and(eq(libraryItems.userId, userId), eq(libraryItems.id, update.id)));
    written += 1;
  }
  return written;
}
