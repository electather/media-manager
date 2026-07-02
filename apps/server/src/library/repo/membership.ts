import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

// Stay below SQLite's SQLITE_MAX_VARIABLE_NUMBER (999) so notInArray never
// exceeds the bound regardless of build. tombstoneMissing chunks to this limit.
const SQLITE_VARIABLE_LIMIT = 900;

// New owned row for membership sync. id is "<mediaType>:<tmdbId>" composite.
// Denormalized columns (sort/facet keys, franchise, hydratedAt) left at schema
// defaults — phase-2 hydrate job fills them in.
export interface OwnedRowInput {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: MediaType;
  ownedAt: number;
}

// Inserts owned rows. Conflict on (user_id, id) does NOTHING — previously-
// tombstoned rows never resurrect (design §Sync + hydrate, watchlist tombstone
// pattern). Conflict path guards against racing concurrent syncs only.
export async function upsertOwned(rows: OwnedRowInput[], db: Db = getDb()): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(libraryItems)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: libraryItems.id });
  return inserted.length;
}

// Tombstones owned rows absent from keepKeys. When keepKeys exceeds
// SQLITE_VARIABLE_LIMIT: read ids, compute absent set, tombstone in chunks.
// Three-path guard (empty/fast notInArray/slow chunked inArray) handles variable limit.
// fallow-ignore-next-line complexity
/**
 * Slow path opens its own `db.transaction`, so `db` MUST be a top-level handle,
 * never an active `tx` — libsql HTTP mode has no savepoints, so a nested
 * `tx.transaction()` would throw. The sole caller (`service.syncMembership`)
 * passes the default `getDb()`.
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
    // Fast path: all keys fit in one predicate. Shares the UPDATE skeleton with
    // the slow path below but applies the opposite predicate (`notInArray` over
    // the keep set vs chunked `inArray` over the computed absent set); merging
    // them would couple the two SQLite-variable-limit strategies.
    // fallow-ignore-next-line code-duplication
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

  // Slow path: read-then-update. In-process writers are already serialized per
  // user by `syncMutex` (design §Sync, #911). The transaction adds cross-process
  // atomicity the mutex cannot: libsql opens transactions BEGIN IMMEDIATE (write
  // lock from start) in local-file and embedded-replica modes — the modes this
  // stack runs — so the step-1 read and step-2 sweep commit atomically even
  // against a second instance, without relying on the single-instance assumption.
  return db.transaction(async (tx) => {
    // Step 1: collect currently-owned ids.
    const ownedRows = await tx
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
      // Shares the UPDATE skeleton with the fast path above; see the note there.
      // fallow-ignore-next-line code-duplication
      const tombstoned = await tx
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
  });
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
