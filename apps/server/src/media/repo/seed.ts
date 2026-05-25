import { eq } from "drizzle-orm";
import { getDb, type Db } from "../../db/client";
import { userWatchlistSeed, watchlistItems } from "../../db/schema/media";

/**
 * Inserts the seed marker exactly once for `userId`. Returns true when the
 * caller wrote the row (and so should run the plugin fetch) and false when a
 * concurrent caller already won the race.
 */
export async function trySeedLock(userId: string, now: number, db: Db = getDb()): Promise<boolean> {
  const inserted = await db
    .insert(userWatchlistSeed)
    .values({ userId, seededAt: now })
    .onConflictDoNothing()
    .returning({ userId: userWatchlistSeed.userId });
  return inserted.length > 0;
}

/** Rolls back a `trySeedLock` claim. Called on plugin error so the next GET retries. */
export async function clearSeedLock(userId: string, db: Db = getDb()): Promise<void> {
  await db.delete(userWatchlistSeed).where(eq(userWatchlistSeed.userId, userId));
}

export async function markUserSeeded(userId: string, now: number, db: Db = getDb()): Promise<void> {
  await db.insert(userWatchlistSeed).values({ userId, seededAt: now }).onConflictDoNothing();
}

export async function hasUserSeeded(userId: string, db: Db = getDb()): Promise<boolean> {
  const row = await db
    .select({ userId: userWatchlistSeed.userId })
    .from(userWatchlistSeed)
    .where(eq(userWatchlistSeed.userId, userId))
    .get();
  return row != null;
}

export async function listSeededUserIds(db: Db = getDb()): Promise<{ userId: string }[]> {
  return db.select({ userId: userWatchlistSeed.userId }).from(userWatchlistSeed);
}

/** Test-only: drop all active-row data. */
export async function __resetActiveRowsForTests(db: Db = getDb()): Promise<void> {
  await db.delete(watchlistItems);
  await db.delete(userWatchlistSeed);
}
