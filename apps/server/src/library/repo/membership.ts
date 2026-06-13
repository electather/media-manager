import { and, eq, notInArray } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

/**
 * A new owned row to insert during membership sync. `id` is the composite
 * `"<mediaType>:<tmdbId>"`. Denormalized columns (sort/facet keys, franchise,
 * `hydratedAt`) are left at their schema defaults — the phase-2 hydrate job
 * fills them in.
 */
export interface OwnedRowInput {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: MediaType;
  ownedAt: number;
}

/**
 * Inserts new owned rows. Conflicts on the `(user_id, id)` primary key do
 * NOTHING, so a previously-tombstoned row (`owned = false`) is never resurrected
 * by a later sync (design §Sync + hydrate, watchlist tombstone pattern). The
 * composite key means the same title owned by another user is a distinct row,
 * not a conflict. Callers pre-filter
 * to keys absent from `allKnownKeys`, so the conflict path only guards against
 * a concurrent racing sync. Returns the number of rows actually inserted.
 */
export async function upsertOwned(rows: OwnedRowInput[], db: Db = getDb()): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(libraryItems)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: libraryItems.id });
  return inserted.length;
}

/**
 * Tombstones every currently-owned row for `userId` whose composite id is
 * absent from `keepKeys` (the keys present in the latest feed). Sets
 * `owned = false` and stamps `unownedAt`. Already-tombstoned rows are untouched
 * (the `owned = true` predicate excludes them). Returns the number tombstoned.
 */
export async function tombstoneMissing(
  userId: string,
  keepKeys: string[],
  now: number,
  db: Db = getDb(),
): Promise<number> {
  const base = and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true));
  const where = keepKeys.length > 0 ? and(base, notInArray(libraryItems.id, keepKeys)) : base;
  const tombstoned = await db
    .update(libraryItems)
    .set({ owned: false, unownedAt: now })
    .where(where)
    .returning({ id: libraryItems.id });
  return tombstoned.length;
}

/**
 * Returns the set of composite ids (`"<mediaType>:<tmdbId>"`) known for the
 * user in any state. Membership sync diffs the feed against this so a key the
 * user has already tombstoned is never re-inserted as owned.
 */
export async function allKnownKeys(userId: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ id: libraryItems.id })
    .from(libraryItems)
    .where(eq(libraryItems.userId, userId));
  return new Set(rows.map((row) => row.id));
}
