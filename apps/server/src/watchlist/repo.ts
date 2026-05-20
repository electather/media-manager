import { and, desc, eq, lt, or, sql } from "drizzle-orm";
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
    seeded: Boolean(raw.seeded),
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

export interface PageCursor {
  addedAt: number;
  id: string;
}

/**
 * Encode/decode are deliberately url-safe + opaque so clients pass the cursor
 * through verbatim. Base64 of `${addedAt}:${id}` — id is a cuid, so no `:` in
 * either component.
 */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.addedAt}:${cursor.id}`, "utf8").toString("base64url");
}

// fallow-ignore-next-line complexity
export function decodeCursor(raw: string): PageCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx <= 0) return null;
    const addedAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(addedAt) || id.length === 0) return null;
    return { addedAt, id };
  } catch {
    return null;
  }
}

/**
 * Keyset-paginated read of active rows in `(added_at DESC, id DESC)` order.
 * Caller asks for `limit` rows past `cursor`. Returns up to `limit` rows;
 * callers slice / re-page based on whether the result was full.
 */
export async function listPage(
  userId: string,
  opts: { cursor?: PageCursor; limit: number },
  db: Db = getDb(),
): Promise<WatchlistRow[]> {
  const conditions = [eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")];
  if (opts.cursor) {
    // Strict keyset: rows are sorted (added_at DESC, id DESC), so the next
    // page starts at rows that are *strictly less* than the cursor in that
    // composite key.
    conditions.push(
      or(
        lt(watchlistItems.addedAt, opts.cursor.addedAt),
        and(eq(watchlistItems.addedAt, opts.cursor.addedAt), lt(watchlistItems.id, opts.cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(and(...conditions))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id))
    .limit(opts.limit);
  return rows.map(toRow);
}

/** Count of active rows for the user. Used by the `/counts` endpoint. */
export async function countActive(userId: string, db: Db = getDb()): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .get();
  return row?.n ?? 0;
}

/** All active rows for the user, newest first. Used by `/counts`. */
export async function listAllActive(userId: string, db: Db = getDb()): Promise<WatchlistRow[]> {
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id));
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
      // Reactivation is not a brand-new insert; `created` flags only the
      // first-ever insert so a future caller can distinguish the two.
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

export async function markSeeded(userId: string, now: number, db: Db = getDb()): Promise<void> {
  await db.insert(userWatchlistSeed).values({ userId, seededAt: now }).onConflictDoNothing();
}

/**
 * Inserts the seed marker exactly once for `userId`. Returns true when the
 * caller wrote the row (and so should run the plugin fetch) and false when a
 * concurrent caller already won the race. Backed by SQLite's UNIQUE PK so the
 * decision is atomic.
 */
export async function trySeedLock(userId: string, now: number, db: Db = getDb()): Promise<boolean> {
  const inserted = await db
    .insert(userWatchlistSeed)
    .values({ userId, seededAt: now })
    .onConflictDoNothing()
    .returning({ userId: userWatchlistSeed.userId });
  return inserted.length > 0;
}

/**
 * Rolls back a `trySeedLock` claim. Called from `seedFromPlugins` when the
 * plugin feed throws or returns a partial result so the next GET retries.
 * Also used by test teardown.
 */
export async function clearSeedLock(userId: string, db: Db = getDb()): Promise<void> {
  await db.delete(userWatchlistSeed).where(eq(userWatchlistSeed.userId, userId));
}

export async function hasSeeded(userId: string, db: Db = getDb()): Promise<boolean> {
  const row = await db
    .select({ userId: userWatchlistSeed.userId })
    .from(userWatchlistSeed)
    .where(eq(userWatchlistSeed.userId, userId))
    .get();
  return row != null;
}

export async function hasActiveRows(userId: string, db: Db = getDb()): Promise<boolean> {
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
