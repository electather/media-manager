import { eq } from "drizzle-orm";
import { getDb, type Db } from "../../db/client";
import { userLibrarySeed } from "../../db/schema/library";

/**
 * Inserts the seed marker exactly once for `userId`. Returns true when the
 * caller wrote the row (and so should run the membership fetch) and false when
 * a concurrent caller already won the race. Mirrors `media/repo/seed.ts`.
 */
export async function trySeedLock(userId: string, now: number, db: Db = getDb()): Promise<boolean> {
  const inserted = await db
    .insert(userLibrarySeed)
    .values({ userId, seededAt: now })
    .onConflictDoNothing()
    .returning({ userId: userLibrarySeed.userId });
  return inserted.length > 0;
}

/** Rolls back a `trySeedLock` claim. Called on a feed error so the next read retries. */
export async function clearSeedLock(userId: string, db: Db = getDb()): Promise<void> {
  await db.delete(userLibrarySeed).where(eq(userLibrarySeed.userId, userId));
}

/** Lists the ids of every seeded user. The sync cron iterates exactly this set. */
export async function listSeededUserIds(db: Db = getDb()): Promise<{ userId: string }[]> {
  return db.select({ userId: userLibrarySeed.userId }).from(userLibrarySeed);
}
