import { eq } from "drizzle-orm";
import type { WatchlistKey, WatchlistSource } from "@ent-mcp/shared/watchlist";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { getDb, type Db } from "../../db/client";
import { watchlistItems } from "../../db/schema/media";
import { selectRowByKey } from "./internal";
import { toRow } from "./row";

function newId(): string {
  return crypto.randomUUID();
}

export interface UpsertActiveResult {
  row: ActiveRow;
  /** True when a brand-new row was inserted or a removed row was reactivated. */
  created: boolean;
  /** True when the row was already in the `active` state before this call. */
  wasActive: boolean;
}

/**
 * Insert (or reactivate) an active row for `(userId, key)`. Wrapped in a
 * transaction so concurrent first-writes serialize via SQLite's
 * `BEGIN IMMEDIATE` and the UNIQUE constraint can never produce a duplicate.
 */
export async function upsertActiveRow(
  userId: string,
  key: WatchlistKey,
  source: WatchlistSource,
  now: number,
  db: Db = getDb(),
): Promise<UpsertActiveResult> {
  // fallow-ignore-next-line complexity
  return db.transaction(async (tx) => {
    const existing = await selectRowByKey(tx, userId, key);
    if (existing && existing.state === "active") {
      return { row: toRow(existing), created: false, wasActive: true };
    }
    if (existing && existing.state === "removed") {
      const updated = await tx
        .update(watchlistItems)
        .set({ state: "active", source, addedAt: now, removedAt: null })
        .where(eq(watchlistItems.id, existing.id))
        .returning()
        .get();
      return { row: toRow(updated!), created: false, wasActive: false };
    }
    const inserted = await tx
      .insert(watchlistItems)
      .values({
        id: newId(),
        userId,
        tmdbId: key.tmdbId,
        mediaType: key.mediaType,
        state: "active",
        source,
        addedAt: now,
        removedAt: null,
        seeded: 0,
      })
      .returning()
      .get();
    return { row: toRow(inserted!), created: true, wasActive: false };
  });
}

export interface SoftRemoveResult {
  /** True when an active row transitioned to `removed`. */
  removed: boolean;
  row: ActiveRow | null;
}

export async function softRemoveRow(
  userId: string,
  key: WatchlistKey,
  now: number,
  db: Db = getDb(),
): Promise<SoftRemoveResult> {
  return db.transaction(async (tx) => {
    const existing = await selectRowByKey(tx, userId, key);
    if (!existing || existing.state === "removed") {
      return { removed: false, row: existing ? toRow(existing) : null };
    }
    const updated = await tx
      .update(watchlistItems)
      .set({ state: "removed", removedAt: now })
      .where(eq(watchlistItems.id, existing.id))
      .returning()
      .get();
    return { removed: true, row: toRow(updated!) };
  });
}

/**
 * Bulk-inserts `keys` for `userId` ignoring rows that already exist (in any
 * state). Returns the number of brand-new rows actually written.
 */
export async function bulkInsertActiveRows(
  userId: string,
  keys: WatchlistKey[],
  source: WatchlistSource,
  seeded: boolean,
  now: number,
  db: Db = getDb(),
): Promise<number> {
  if (keys.length === 0) return 0;
  const values = keys.map((k) => ({
    id: newId(),
    userId,
    tmdbId: k.tmdbId,
    mediaType: k.mediaType,
    state: "active" as const,
    source,
    addedAt: now,
    removedAt: null,
    seeded: seeded ? 1 : 0,
  }));
  const inserted = await db
    .insert(watchlistItems)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: watchlistItems.id });
  return inserted.length;
}
