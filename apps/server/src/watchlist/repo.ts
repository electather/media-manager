import { and, desc, eq } from "drizzle-orm";
import { keyToId, type WatchlistKey, type WatchlistSource } from "@ent-mcp/shared/watchlist";
import { getDb, type Db } from "../db/client";
import { userWatchlistSeed, watchlistItems } from "../db/schema/watchlist";

export interface WatchlistRow {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  state: "active" | "removed";
  source: WatchlistSource;
  addedAt: number;
  removedAt: number | null;
  seeded: boolean;
}

export interface UpsertActiveResult {
  row: WatchlistRow;
  /** True when a brand-new row was inserted or a removed row was reactivated. */
  created: boolean;
  /** True when the row was already in the `active` state before this call. */
  wasActive: boolean;
}

function toRow(raw: typeof watchlistItems.$inferSelect): WatchlistRow {
  return {
    id: raw.id,
    userId: raw.userId,
    tmdbId: raw.tmdbId,
    mediaType: raw.mediaType,
    state: raw.state,
    source: raw.source as WatchlistSource,
    addedAt: raw.addedAt,
    removedAt: raw.removedAt,
    seeded: raw.seeded === 1,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

export async function list(
  userId: string,
  opts: { state?: "active" | "removed"; limit?: number } = {},
  db: Db = getDb(),
): Promise<WatchlistRow[]> {
  const state = opts.state ?? "active";
  let query = db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, state)))
    .orderBy(desc(watchlistItems.addedAt));
  if (opts.limit != null) query = query.limit(opts.limit) as typeof query;
  const rows = await query;
  return rows.map(toRow);
}

export async function findByKey(
  userId: string,
  key: WatchlistKey,
  db: Db = getDb(),
): Promise<WatchlistRow | null> {
  const row = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.tmdbId, key.tmdbId),
        eq(watchlistItems.mediaType, key.mediaType),
      ),
    )
    .get();
  return row ? toRow(row) : null;
}

/**
 * Insert (or reactivate) an active row for `(userId, key)`. Wrapped in a
 * transaction so concurrent first-writes serialize via SQLite's
 * `BEGIN IMMEDIATE` and the UNIQUE constraint can never produce a duplicate.
 */
export async function upsertActive(
  userId: string,
  key: WatchlistKey,
  source: WatchlistSource,
  now: number,
  db: Db = getDb(),
): Promise<UpsertActiveResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.tmdbId, key.tmdbId),
          eq(watchlistItems.mediaType, key.mediaType),
        ),
      )
      .get();
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
      return { row: toRow(updated!), created: true, wasActive: false };
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
  row: WatchlistRow | null;
}

export async function softRemove(
  userId: string,
  key: WatchlistKey,
  now: number,
  db: Db = getDb(),
): Promise<SoftRemoveResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.tmdbId, key.tmdbId),
          eq(watchlistItems.mediaType, key.mediaType),
        ),
      )
      .get();
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
export async function bulkInsertIgnoreConflict(
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

/**
 * Returns the set of `mediaType:tmdbId` composite ids known for the user in
 * any state. Plugin sync uses this to skip keys the user has already removed
 * so we never resurrect them.
 */
export async function allKnownKeys(userId: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ tmdbId: watchlistItems.tmdbId, mediaType: watchlistItems.mediaType })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId));
  const out = new Set<string>();
  for (const row of rows) out.add(keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType }));
  return out;
}

export async function markSeeded(
  userId: string,
  now: number,
  db: Db = getDb(),
): Promise<void> {
  await db
    .insert(userWatchlistSeed)
    .values({ userId, seededAt: now })
    .onConflictDoNothing();
}

export async function hasSeeded(userId: string, db: Db = getDb()): Promise<boolean> {
  const row = await db
    .select({ userId: userWatchlistSeed.userId })
    .from(userWatchlistSeed)
    .where(eq(userWatchlistSeed.userId, userId))
    .get();
  return row != null;
}

export async function hasAny(userId: string, db: Db = getDb()): Promise<boolean> {
  const row = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .limit(1)
    .get();
  return row != null;
}

/**
 * Returns active rows for `userId`, newest first. `limit` caps the number of
 * candidate rows the service then probes via `getMatchingServers`.
 */
export async function listAvailableCandidates(
  userId: string,
  limit: number,
  db: Db = getDb(),
): Promise<WatchlistRow[]> {
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .orderBy(desc(watchlistItems.addedAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function listSeededUserIds(db: Db = getDb()): Promise<{ userId: string }[]> {
  return db.select({ userId: userWatchlistSeed.userId }).from(userWatchlistSeed);
}

/** Test-only: drop all data. */
export async function __resetForTests(db: Db = getDb()): Promise<void> {
  await db.delete(watchlistItems);
  await db.delete(userWatchlistSeed);
}

