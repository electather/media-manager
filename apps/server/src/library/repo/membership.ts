import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

/**
 * SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999. Stay conservatively
 * below it so a single `notInArray` predicate never exceeds the bound
 * regardless of SQLite build version. {@link tombstoneMissing} chunks
 * `keepKeys` to this limit.
 */
const SQLITE_VARIABLE_LIMIT = 900;

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
 *
 * When `keepKeys` exceeds {@link SQLITE_VARIABLE_LIMIT} the function falls
 * back to a two-step approach: (1) read all currently-owned ids for the user,
 * (2) compute the absent set in JS (owned minus keepKeys), then tombstone those
 * specific ids in bounded `IN` chunks. This stays within SQLite's
 * bound-parameter limit for arbitrarily large libraries.
 */
export async function tombstoneMissing(
  userId: string,
  keepKeys: string[],
  now: number,
  db: Db = getDb(),
): Promise<number> {
  if (keepKeys.length === 0) {
    // An empty keepKeys means the full library should be tombstoned — no
    // chunking needed, use the base predicate directly.
    const tombstoned = await db
      .update(libraryItems)
      .set({ owned: false, unownedAt: now })
      .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)))
      .returning({ id: libraryItems.id });
    return tombstoned.length;
  }

  if (keepKeys.length <= SQLITE_VARIABLE_LIMIT) {
    // Fast path: all keys fit in one predicate.
    const tombstoned = await db
      .update(libraryItems)
      .set({ owned: false, unownedAt: now })
      .where(
        and(
          eq(libraryItems.userId, userId),
          eq(libraryItems.owned, true),
          notInArray(libraryItems.id, keepKeys),
        ),
      )
      .returning({ id: libraryItems.id });
    return tombstoned.length;
  }

  // Slow path: keepKeys exceeds the SQLite variable limit so a single NOT IN
  // predicate is not safe. Instead, fetch the owned id set, compute the absent
  // ids in JS, and tombstone them by id using bounded IN predicates.
  //
  // Step 1: collect currently-owned ids for this user.
  const ownedRows = await db
    .select({ id: libraryItems.id })
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)));

  const keepSet = new Set(keepKeys);
  const toTombstone = ownedRows.map((row) => row.id).filter((id) => !keepSet.has(id));

  if (toTombstone.length === 0) return 0;

  // Step 2: tombstone the computed absent set in bounded UPDATE chunks using
  // `inArray` so each UPDATE targets only the rows that should be tombstoned,
  // with no risk of accidentally touching rows in the keep set.
  let count = 0;
  for (let i = 0; i < toTombstone.length; i += SQLITE_VARIABLE_LIMIT) {
    const slice = toTombstone.slice(i, i + SQLITE_VARIABLE_LIMIT);
    const tombstoned = await db
      .update(libraryItems)
      .set({ owned: false, unownedAt: now })
      .where(
        and(
          eq(libraryItems.userId, userId),
          eq(libraryItems.owned, true),
          inArray(libraryItems.id, slice),
        ),
      )
      .returning({ id: libraryItems.id });
    count += tombstoned.length;
  }
  return count;
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
